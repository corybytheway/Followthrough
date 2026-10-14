// Created by Cory McCabe
// Rasterize the existing Followthrough favicon geometry for native icon assets.
import AppKit
import Foundation

let root = URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent()
let catalog = root.appendingPathComponent("Assets.xcassets")
let directory = catalog.appendingPathComponent("AppIcon.appiconset")
try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
func color(_ hex: UInt32) -> NSColor { NSColor(srgbRed:CGFloat((hex >> 16) & 255)/255,green:CGFloat((hex >> 8) & 255)/255,blue:CGFloat(hex & 255)/255,alpha:1) }
func render(_ pixels: Int, mac: Bool) throws -> String {
    let image = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:image)
    let context=NSGraphicsContext.current!.cgContext
    context.scaleBy(x:CGFloat(pixels)/64,y:CGFloat(pixels)/64)
    context.translateBy(x:0,y:64); context.scaleBy(x:1,y:-1)
    if mac { context.translateBy(x:5,y:5); context.scaleBy(x:54/64,y:54/64) }
    color(0x15243b).setFill()
    NSBezierPath(roundedRect:NSRect(x:0,y:0,width:64,height:64),xRadius:mac ? 14 : 0,yRadius:mac ? 14 : 0).fill()
    let bolt=NSBezierPath()
    for (index,point) in [NSPoint(x:36,y:12),NSPoint(x:18,y:35),NSPoint(x:30,y:35),NSPoint(x:28,y:52),NSPoint(x:47,y:27),NSPoint(x:35,y:27)].enumerated() {
        if index == 0 { bolt.move(to:point) } else { bolt.line(to:point) }
    }
    bolt.close(); color(0xc3fa71).setFill(); bolt.fill()
    NSGraphicsContext.restoreGraphicsState()
    let filename="\(mac ? "mac" : "ios")-\(pixels).png"
    try image.representation(using:.png,properties:[:])!.write(to:directory.appendingPathComponent(filename))
    return filename
}
var images:[[String:String]]=[]
for size in [16,32,128,256,512] {
    for scale in [1,2] { images.append(["idiom":"mac","size":"\(size)x\(size)","scale":"\(scale)x","filename":try render(size*scale,mac:true)]) }
}
images.append(["idiom":"universal","platform":"ios","size":"1024x1024","filename":try render(1024,mac:false)])
func write(_ object:[String:Any],to url:URL) throws { try JSONSerialization.data(withJSONObject:object,options:[.prettyPrinted,.sortedKeys]).write(to:url) }
try write(["info":["author":"Cory McCabe","version":1]],to:catalog.appendingPathComponent("Contents.json"))
try write(["images":images,"info":["author":"Cory McCabe","version":1]],to:directory.appendingPathComponent("Contents.json"))
print("Generated Followthrough native icons")
