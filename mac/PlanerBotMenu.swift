// macOS menu-bar control for planer-bot.
//
// Why a separate app at all: the server runs as a SYSTEM LaunchDaemon
// (`com.planerbot.server`) because this Mac has no auto-login and must serve
// from boot, before anyone signs in. That means every start/stop/restart needs
// admin rights — so this app asks for them with the native authorization dialog
// rather than storing a password anywhere. The dialog is safe here precisely
// because a menu bar only exists when somebody is signed in and at the machine.
//
// The icon is drawn in code as a TEMPLATE image: alpha only, no colour. macOS
// tints it for light and dark menu bars and inverts it while the menu is open,
// which is what makes it look native instead of pasted on. Drawing it rather
// than shipping a PNG also means it is sharp on any display without @2x assets.
//
// Build:   swiftc -O mac/PlanerBotMenu.swift -o mac/build/PlanerBotMenu
// Install: see mac/com.planerbot.menubar.plist

import AppKit

// MARK: - Configuration

private enum Config {
    static let serverLabel = "com.planerbot.server"
    static let backupLabel = "com.planerbot.backup"
    static let port: UInt16 = 8090
    static let logPath = NSString(string: "~/planer-bot.log").expandingTildeInPath
    static let backupDir = NSString(string: "~/planer-bot-backups").expandingTildeInPath
    static let envPath = NSString(string: "~/planer-bot-prod/server/.env").expandingTildeInPath
    /// How often the status is re-checked. Five seconds is responsive enough to
    /// feel live without waking the CPU for nothing.
    static let pollSeconds: TimeInterval = 5

    /// Where «Открыть приложение» goes — read from the server's own `.env`, not
    /// written here.
    ///
    /// This repository is public, and the address is a home server: hard-coding it
    /// published a pointer straight at that network, in a file that has no reason
    /// to carry one. `PUBLIC_URL` is already the server's single source of truth
    /// for the same value, and `server/.env` is gitignored — so reading it keeps
    /// the two from ever disagreeing *and* keeps the address off GitHub.
    ///
    /// Falls back to the local port: without the file there is no address to know,
    /// and a menu item that opens localhost is honest, where one that opens nothing
    /// looks broken.
    static let publicURL: String = readPublicURL() ?? "http://localhost:\(port)"

    private static func readPublicURL() -> String? {
        guard let text = try? String(contentsOfFile: envPath, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("PUBLIC_URL=") else { continue }
            let value = trimmed.dropFirst("PUBLIC_URL=".count)
                .trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
            if !value.isEmpty { return value.hasSuffix("/") ? String(value.dropLast()) : value }
        }
        return nil
    }
}

// MARK: - Shell helpers

/// Runs a command and returns its stdout, or nil if it could not be launched.
@discardableResult
private func run(_ launchPath: String, _ arguments: [String]) -> String? {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: launchPath)
    task.arguments = arguments
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = Pipe()
    do { try task.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    return String(data: data, encoding: .utf8)
}

/// Runs one privileged command through the native authorization dialog.
///
/// `launchctl` against the system domain needs root, and this is the sanctioned
/// way to ask for it interactively: macOS shows its own prompt, the password
/// never reaches this process, and nothing is written to disk. Returns an error
/// message when the user cancels or the command fails.
private func runPrivileged(_ command: String) -> String? {
    let script = "do shell script \"\(command)\" with administrator privileges"
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    task.arguments = ["-e", script]
    let errPipe = Pipe()
    task.standardError = errPipe
    task.standardOutput = Pipe()
    do { try task.run() } catch { return "не удалось запустить osascript" }
    let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
    task.waitUntilExit()
    if task.terminationStatus == 0 { return nil }
    let message = String(data: errData, encoding: .utf8) ?? ""
    // A cancelled dialog is a decision, not a failure worth shouting about.
    if message.contains("-128") { return nil }
    return message.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// True when something is listening on the server's port.
///
/// Deliberately checks the port rather than asking launchctl: `launchctl print`
/// on the system domain needs root, and "is it actually serving?" is the
/// question a person means when they glance at the menu bar anyway.
private func serverIsUp() -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }

    var timeout = timeval(tv_sec: 0, tv_usec: 300_000)
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = Config.port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let connected = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
        }
    }
    return connected
}

/// What the server says about itself, not just whether its port is open.
///
/// 07.10.2026 the port was open and `/api/health` green for 18 minutes while the
/// bot could not reach Telegram — the team noticed before anyone at the Mac did.
/// The server now reports that (`bot: "unreachable"`), and this menu is the one
/// place that can show it: a warning sent through Telegram would not arrive.
private enum Health: Equatable {
    case stopped
    case ok
    /// Polling loop is not running at all (`bot: "down"`).
    case botStopped
    case telegramUnreachable(since: Date?)
    /// Port open, but the health request itself failed or timed out.
    case noAnswer

    var serverRunning: Bool { self != .stopped }
    var needsAttention: Bool {
        switch self {
        case .stopped, .ok: return false
        default: return true
        }
    }
}

private func fetchHealth() -> Health {
    guard serverIsUp() else { return .stopped }
    guard let url = URL(string: "http://127.0.0.1:\(Config.port)/api/health") else { return .noAnswer }
    var request = URLRequest(url: url)
    request.timeoutInterval = 2
    var body: Data?
    let done = DispatchSemaphore(value: 0)
    URLSession.shared.dataTask(with: request) { data, _, _ in
        body = data
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 3)
    guard let data = body,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .noAnswer }
    if json["ok"] as? Bool == true { return .ok }
    switch json["bot"] as? String {
    case "down": return .botStopped
    case "unreachable":
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return .telegramUnreachable(since: (json["since"] as? String).flatMap(iso.date(from:)))
    default: return .noAnswer
    }
}

/// A macOS notification without an .app bundle: UNUserNotificationCenter needs
/// one, `osascript` does not.
private func notify(_ title: String, _ text: String) {
    let escape = { (s: String) in s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
    _ = run("/usr/bin/osascript", ["-e", "display notification \"\(escape(text))\" with title \"\(escape(title))\" sound name \"Basso\""])
}

private func clock(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm"
    return formatter.string(from: date)
}

/// "сегодня в 04:30" for the newest file in the backup folder, or nil if empty.
private func lastBackupDescription() -> String? {
    let fm = FileManager.default
    guard let names = try? fm.contentsOfDirectory(atPath: Config.backupDir) else { return nil }
    let newest = names
        .filter { $0.hasSuffix(".db") }
        .compactMap { name -> Date? in
            let path = (Config.backupDir as NSString).appendingPathComponent(name)
            return (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date
        }
        .max()
    guard let date = newest else { return nil }

    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ru_RU")
    formatter.doesRelativeDateFormatting = true
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?

    private let statusLine = NSMenuItem(title: "Проверяю…", action: nil, keyEquivalent: "")
    private let backupLine = NSMenuItem(title: "Бэкап: —", action: nil, keyEquivalent: "")
    private let startItem = NSMenuItem(title: "Запустить", action: #selector(doStart), keyEquivalent: "")
    private let stopItem = NSMenuItem(title: "Остановить", action: #selector(doStop), keyEquivalent: "")
    private let restartItem = NSMenuItem(title: "Перезапустить", action: #selector(doRestart), keyEquivalent: "")

    private var running = false
    /// nil until the first check: a menu started during an outage should still
    /// announce it once.
    private var lastHealth: Health?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Accessory, not regular: a menu-bar tool has no business in the Dock or
        // the app switcher. Doing this in code avoids needing an .app bundle.
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = makeIcon(running: false)
        statusItem.button?.toolTip = "planer-bot"

        let menu = NSMenu()
        statusLine.isEnabled = false
        backupLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(backupLine)
        menu.addItem(.separator())

        menu.addItem(withTitle: "Открыть мини-апп", action: #selector(openApp), keyEquivalent: "")
        menu.addItem(withTitle: "Открыть админку", action: #selector(openAdmin), keyEquivalent: "")
        menu.addItem(.separator())

        for item in [startItem, stopItem, restartItem] {
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())

        menu.addItem(withTitle: "Сделать бэкап сейчас", action: #selector(backupNow), keyEquivalent: "")
        menu.addItem(withTitle: "Показать лог сервера", action: #selector(openLog), keyEquivalent: "")
        menu.addItem(withTitle: "Папка бэкапов", action: #selector(openBackups), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Выйти из меню", action: #selector(quit), keyEquivalent: "q")

        for item in menu.items where item.action != nil && item.target == nil {
            item.target = self
        }
        statusItem.menu = menu

        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: Config.pollSeconds, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    // MARK: Status

    private func refresh() {
        DispatchQueue.global(qos: .utility).async {
            let health = fetchHealth()
            let backup = lastBackupDescription()
            DispatchQueue.main.async { self.apply(health: health, backup: backup) }
        }
    }

    private func apply(health: Health, backup: String?) {
        let up = health.serverRunning
        if up != running || statusItem.button?.image == nil {
            statusItem.button?.image = makeIcon(running: up)
        }
        running = up
        // A mark beside the icon rather than a recoloured icon: the icon is a
        // template image and macOS owns its colour.
        statusItem.button?.title = health.needsAttention ? "⚠︎" : ""
        statusItem.button?.imagePosition = .imageLeft
        statusLine.title = describe(health)
        announceChange(from: lastHealth, to: health)
        lastHealth = health
        backupLine.title = backup.map { "Последний бэкап: \($0)" } ?? "Бэкапов пока нет"
        startItem.isHidden = up
        stopItem.isHidden = !up
        restartItem.isHidden = !up
    }

    private func describe(_ health: Health) -> String {
        switch health {
        case .stopped: return "Сервер остановлен"
        case .ok: return "Сервер работает · :\(Config.port)"
        case .botStopped: return "⚠︎ Бот не опрашивает Telegram"
        case .telegramUnreachable(let since):
            return "⚠︎ Нет связи с Telegram" + (since.map { " с \(clock($0))" } ?? "")
        case .noAnswer: return "⚠︎ Сервер не отвечает на проверку"
        }
    }

    /// Only on the edge, not every five seconds: a sound per poll would be muted
    /// within a minute, and then the one that matters is muted too.
    private func announceChange(from old: Health?, to new: Health) {
        let wasBad = old?.needsAttention ?? false
        if new.needsAttention && !wasBad {
            notify("planer-bot", describe(new).replacingOccurrences(of: "⚠︎ ", with: "") + " — команда не получает ответов бота")
        } else if wasBad && new == .ok {
            // Говорить о том, что пропадало: «связь вернулась» после зависшего
            // сервера сбивает с толку, когда в следующий раз ищешь причину.
            if case .telegramUnreachable = old {
                notify("planer-bot", "Связь с Telegram вернулась")
            } else {
                notify("planer-bot", "Бот снова в порядке")
            }
        }
    }

    /// Runs a privileged launchctl command, then re-checks status. Any failure is
    /// shown as an alert — silently doing nothing after a click is worse than a
    /// message, and the most likely cause (cancelled dialog) is already filtered out.
    private func control(_ command: String, failure: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            let error = runPrivileged(command)
            DispatchQueue.main.async {
                if let error, !error.isEmpty {
                    let alert = NSAlert()
                    alert.messageText = failure
                    alert.informativeText = error
                    alert.alertStyle = .warning
                    alert.runModal()
                }
                self.refresh()
            }
        }
    }

    // MARK: Actions

    @objc private func doStart() {
        control("launchctl bootstrap system /Library/LaunchDaemons/\(Config.serverLabel).plist",
                failure: "Не удалось запустить сервер")
    }

    @objc private func doStop() {
        control("launchctl bootout system/\(Config.serverLabel)",
                failure: "Не удалось остановить сервер")
    }

    @objc private func doRestart() {
        // kickstart -k terminates the old instance and starts exactly one new one.
        // launchd guarantees the single instance, which matters: two processes on
        // one BOT_TOKEN mean Telegram 409s and duplicate DMs to the whole team.
        control("launchctl kickstart -k system/\(Config.serverLabel)",
                failure: "Не удалось перезапустить сервер")
    }

    @objc private func backupNow() {
        control("launchctl kickstart system/\(Config.backupLabel)",
                failure: "Не удалось сделать бэкап")
    }

    @objc private func openApp() { open("\(Config.publicURL)/app/") }
    @objc private func openAdmin() { open("\(Config.publicURL)/admin/") }

    @objc private func openLog() {
        run("/usr/bin/open", ["-a", "Console", Config.logPath])
    }

    @objc private func openBackups() {
        run("/usr/bin/open", [Config.backupDir])
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func open(_ url: String) {
        guard let link = URL(string: url) else { return }
        NSWorkspace.shared.open(link)
    }
}

// `@main` rather than top-level code: Swift only allows top-level statements in
// a file literally named main.swift, and this file is compiled alongside the
// icon module and the preview tool.
@main
struct PlanerBotMenu {
    static func main() {
        let app = NSApplication.shared
        // Held for the lifetime of `run()`, which blocks until the app quits.
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
