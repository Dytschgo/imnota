import CoreGraphics
import Foundation

// A bundled, read-only WindowServer probe. The parent app still captures screen
// pixels through Electron; this helper never writes images or project files.
func number(_ dictionary: NSDictionary, _ key: CFString) -> NSNumber? {
    dictionary[key as String] as? NSNumber
}

let arguments = CommandLine.arguments
guard arguments.count == 3, let excludedId = Int(arguments[2]), excludedId >= 0 else {
    fputs("Expected windows <pid> or hidden <window-id>.\n", stderr)
    exit(2)
}

func onScreenWindows() -> [NSDictionary]? {
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [NSDictionary]
}

if arguments[1] == "hidden" {
    let deadline = ProcessInfo.processInfo.systemUptime + 2.0
    while ProcessInfo.processInfo.systemUptime < deadline {
        guard let windows = onScreenWindows() else {
            fputs("WindowServer did not return an on-screen window list.\n", stderr)
            exit(3)
        }
        if !windows.contains(where: { number($0, kCGWindowNumber)?.intValue == excludedId }) {
            print("hidden")
            exit(0)
        }
        Thread.sleep(forTimeInterval: 0.016)
    }
    fputs("The Imnota window remained on screen after hiding.\n", stderr)
    exit(5)
}

guard arguments[1] == "windows" else {
    fputs("Unknown capture helper mode.\n", stderr)
    exit(2)
}

guard let windows = onScreenWindows() else {
    fputs("WindowServer did not return an on-screen window list.\n", stderr)
    exit(3)
}

var result: [[String: Any]] = []
for window in windows {
    if result.count >= 80 { break }
    guard number(window, kCGWindowOwnerPID)?.intValue != excludedId,
          number(window, kCGWindowLayer)?.intValue == 0,
          let id = number(window, kCGWindowNumber)?.uint32Value,
          let title = (window[kCGWindowName as String] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty,
          let encodedBounds = window[kCGWindowBounds as String] as? NSDictionary,
          let x = encodedBounds["X"] as? NSNumber,
          let y = encodedBounds["Y"] as? NSNumber,
          let width = encodedBounds["Width"] as? NSNumber,
          let height = encodedBounds["Height"] as? NSNumber else { continue }
    let bounds = CGRect(x: x.doubleValue, y: y.doubleValue,
                        width: width.doubleValue, height: height.doubleValue)
    guard
          bounds.width >= 1, bounds.height >= 1,
          bounds.origin.x.isFinite, bounds.origin.y.isFinite,
          bounds.width.isFinite, bounds.height.isFinite else { continue }
    result.append([
        "id": "window:\(id)",
        "title": String(title.prefix(120)),
        "bounds": ["x": bounds.origin.x, "y": bounds.origin.y,
                   "width": bounds.width, "height": bounds.height],
    ])
}

guard JSONSerialization.isValidJSONObject(result),
      let data = try? JSONSerialization.data(withJSONObject: result),
      let text = String(data: data, encoding: .utf8) else {
    fputs("Could not encode window metadata.\n", stderr)
    exit(4)
}
print(text)
