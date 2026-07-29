// Renders the menu-bar icon to PNGs so it can be judged at a size the eye can
// actually see. Not part of the app — a development tool.
//
//   swiftc -O mac/PlanerBotIcon.swift mac/IconPreview.swift -o mac/build/IconPreview
//   mac/build/IconPreview <outputDir>

import AppKit

@main
struct IconPreview {
    static func main() {
        let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

        for (name, running) in [("running", true), ("stopped", false)] {
            for scale in [1, 8] as [Int] {
                let icon = makeIcon(running: running)
                let side = 18 * scale
                let big = NSImage(size: NSSize(width: side, height: side))
                big.lockFocus()
                NSGraphicsContext.current?.imageInterpolation = .none
                // Template images carry alpha only; paint it black on white so the shape
                // is visible in a plain PNG viewer.
                NSColor.white.setFill()
                NSRect(x: 0, y: 0, width: side, height: side).fill()
                icon.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
                big.unlockFocus()

                guard let tiff = big.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else { continue }
                let path = "\(outDir)/icon-\(name)-\(scale)x.png"
                try? png.write(to: URL(fileURLWithPath: path))
                print("wrote \(path)")
            }
        }
    }
}
