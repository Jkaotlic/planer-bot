// The menu-bar mark for planer-bot, drawn in code.
//
// Lives in its own file so the preview tool (mac/IconPreview.swift) renders the
// exact same shapes the app shows — a second copy would drift the moment either
// is tweaked.

import AppKit

/// The menu-bar mark: a calendar page with one day picked out.
///
/// Drawn at 18×18, the size AppKit expects for a menu-bar item, and deliberately
/// built from very few shapes — at this size anything more turns to mush. The
/// filled header band is what makes it read as a calendar rather than a plain
/// box, and the single solid cell is the "planned day" the whole product is about.
///
/// `running == false` adds the diagonal slash Apple uses for a disabled state,
/// with a transparent gap punched around it so the cut stays legible against the
/// shapes underneath.
func makeIcon(running: Bool) -> NSImage {
    let side: CGFloat = 18
    let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { _ in
        NSColor.black.setFill()
        NSColor.black.setStroke()

        // Calendar body. Stroked, not filled: an outline reads lighter in the
        // menu bar and leaves room for the cells inside to carry the meaning.
        let body = NSRect(x: 1.6, y: 1.4, width: 14.8, height: 13.2)
        let bodyPath = NSBezierPath(roundedRect: body, xRadius: 2.6, yRadius: 2.6)
        bodyPath.lineWidth = 1.5
        bodyPath.stroke()

        // The two hangers on top. Without them a rounded rectangle is just a box.
        for x in [5.4, 11.0] as [CGFloat] {
            let hanger = NSBezierPath(
                roundedRect: NSRect(x: x, y: 14.0, width: 1.7, height: 2.6),
                xRadius: 0.85, yRadius: 0.85)
            hanger.fill()
        }

        // Header band, clipped to the body so its top corners stay rounded.
        NSGraphicsContext.saveGraphicsState()
        bodyPath.addClip()
        NSBezierPath(rect: NSRect(x: body.minX, y: 11.0, width: body.width, height: 3.6)).fill()
        NSGraphicsContext.restoreGraphicsState()

        // Six day cells, three across and two down. Five are small dots; the one
        // that is picked out is a larger solid square.
        let columns: [CGFloat] = [4.0, 7.9, 11.8]
        let rows: [CGFloat] = [3.0, 6.8]
        let markedColumn = 1, markedRow = 1
        for (ri, y) in rows.enumerated() {
            for (ci, x) in columns.enumerated() {
                if ri == markedRow && ci == markedColumn {
                    NSBezierPath(
                        roundedRect: NSRect(x: x - 0.45, y: y - 0.45, width: 2.9, height: 2.9),
                        xRadius: 0.7, yRadius: 0.7
                    ).fill()
                } else {
                    NSBezierPath(ovalIn: NSRect(x: x, y: y, width: 2.0, height: 2.0)).fill()
                }
            }
        }

        if !running {
            // Punch a transparent channel first, then draw the slash inside it,
            // so the line never merges with the shapes it crosses.
            let slash = NSBezierPath()
            slash.move(to: NSPoint(x: 2.2, y: 2.0))
            slash.line(to: NSPoint(x: 15.8, y: 16.0))

            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.compositingOperation = .clear
            slash.lineWidth = 3.4
            slash.lineCapStyle = .round
            slash.stroke()
            NSGraphicsContext.restoreGraphicsState()

            slash.lineWidth = 1.6
            slash.stroke()
        }
        return true
    }
    image.isTemplate = true
    return image
}

