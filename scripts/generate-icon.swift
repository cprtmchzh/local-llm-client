import AppKit
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    fputs("usage: swift scripts/generate-icon.swift <output.png>\n", stderr)
    exit(2)
}

let canvasSize = NSSize(width: 1024, height: 1024)
guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(canvasSize.width),
    pixelsHigh: Int(canvasSize.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
) else {
    fatalError("could not allocate icon bitmap")
}

NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("could not create icon graphics context")
}
NSGraphicsContext.current = context
context.imageInterpolation = .high

NSColor.clear.setFill()
NSRect(origin: .zero, size: canvasSize).fill()

let tileRect = NSRect(x: 92, y: 92, width: 840, height: 840)
let tile = NSBezierPath(roundedRect: tileRect, xRadius: 220, yRadius: 220)
NSColor(calibratedRed: 0.29, green: 0.43, blue: 0.34, alpha: 1).setFill()
tile.fill()

let innerRect = NSRect(x: 130, y: 130, width: 764, height: 764)
let inner = NSBezierPath(roundedRect: innerRect, xRadius: 188, yRadius: 188)
NSColor(calibratedRed: 0.34, green: 0.49, blue: 0.39, alpha: 1).setStroke()
inner.lineWidth = 5
inner.stroke()

func sparkle(center: NSPoint, horizontal: CGFloat, vertical: CGFloat, lineWidth: CGFloat) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: center.x, y: center.y + vertical))
    path.curve(
        to: NSPoint(x: center.x + horizontal, y: center.y),
        controlPoint1: NSPoint(x: center.x + horizontal * 0.15, y: center.y + vertical * 0.2),
        controlPoint2: NSPoint(x: center.x + horizontal * 0.8, y: center.y + vertical * 0.12)
    )
    path.curve(
        to: NSPoint(x: center.x, y: center.y - vertical),
        controlPoint1: NSPoint(x: center.x + horizontal * 0.8, y: center.y - vertical * 0.12),
        controlPoint2: NSPoint(x: center.x + horizontal * 0.15, y: center.y - vertical * 0.2)
    )
    path.curve(
        to: NSPoint(x: center.x - horizontal, y: center.y),
        controlPoint1: NSPoint(x: center.x - horizontal * 0.15, y: center.y - vertical * 0.2),
        controlPoint2: NSPoint(x: center.x - horizontal * 0.8, y: center.y - vertical * 0.12)
    )
    path.curve(
        to: NSPoint(x: center.x, y: center.y + vertical),
        controlPoint1: NSPoint(x: center.x - horizontal * 0.8, y: center.y + vertical * 0.12),
        controlPoint2: NSPoint(x: center.x - horizontal * 0.15, y: center.y + vertical * 0.2)
    )
    path.close()
    path.lineWidth = lineWidth
    path.lineJoinStyle = .round
    NSColor.white.setStroke()
    path.stroke()
}

sparkle(center: NSPoint(x: 489, y: 521), horizontal: 196, vertical: 244, lineWidth: 35)
sparkle(center: NSPoint(x: 700, y: 713), horizontal: 72, vertical: 88, lineWidth: 25)
sparkle(center: NSPoint(x: 702, y: 335), horizontal: 44, vertical: 53, lineWidth: 20)

NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("could not encode icon PNG")
}

let output = URL(fileURLWithPath: arguments[1])
try FileManager.default.createDirectory(
    at: output.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try png.write(to: output, options: .atomic)
print(output.path)
