#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Raster {
    let width: Int
    let height: Int
    var pixels: [UInt8]
}

enum SurfaceError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case loadFailed(String)
    case contextFailed
    case imageFailed
    case writeFailed(String)

    var description: String {
        switch self {
        case .invalidArguments(let message): return message
        case .loadFailed(let path): return "Could not load image: \(path)"
        case .contextFailed: return "Could not create Core Graphics context"
        case .imageFailed: return "Could not create output image"
        case .writeFailed(let path): return "Could not write image: \(path)"
        }
    }
}

func sourceImage(_ path: String) throws -> CGImage {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw SurfaceError.loadFailed(path)
    }
    return image
}

func rasterize(_ image: CGImage, width: Int, height: Int) throws -> Raster {
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
    let madeContext = pixels.withUnsafeMutableBytes { bytes -> Bool in
        guard let context = CGContext(
            data: bytes.baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else { return false }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard madeContext else { throw SurfaceError.contextFailed }
    return Raster(width: width, height: height, pixels: pixels)
}

func loadRaster(_ path: String, width: Int? = nil, height: Int? = nil) throws -> Raster {
    let image = try sourceImage(path)
    return try rasterize(image, width: width ?? image.width, height: height ?? image.height)
}

func cgImage(_ raster: Raster) throws -> CGImage {
    let data = Data(raster.pixels) as CFData
    guard let provider = CGDataProvider(data: data) else { throw SurfaceError.imageFailed }
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
    guard let image = CGImage(
        width: raster.width,
        height: raster.height,
        bitsPerComponent: 8,
        bitsPerPixel: 32,
        bytesPerRow: raster.width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: bitmapInfo,
        provider: provider,
        decode: nil,
        shouldInterpolate: false,
        intent: .defaultIntent
    ) else { throw SurfaceError.imageFailed }
    return image
}

func write(_ raster: Raster, to path: String, jpegQuality: Double? = nil) throws {
    let url = URL(fileURLWithPath: path) as CFURL
    let type: CFString = jpegQuality == nil ? UTType.png.identifier as CFString : UTType.jpeg.identifier as CFString
    guard let destination = CGImageDestinationCreateWithURL(url, type, 1, nil) else {
        throw SurfaceError.writeFailed(path)
    }
    let properties: CFDictionary?
    if let quality = jpegQuality {
        properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
    } else {
        properties = nil
    }
    CGImageDestinationAddImage(destination, try cgImage(raster), properties)
    guard CGImageDestinationFinalize(destination) else { throw SurfaceError.writeFailed(path) }
}

func blendSeams(_ input: Raster, width blendWidth: Int) -> Raster {
    guard blendWidth > 1 else { return input }
    var output = input
    var source = input.pixels
    let width = input.width
    let height = input.height
    let limitX = min(blendWidth, width / 2)

    for y in 0..<height {
        for distance in 0..<limitX {
            let t = Double(distance) / Double(max(1, limitX - 1))
            let left = (y * width + distance) * 4
            let right = (y * width + (width - 1 - distance)) * 4
            for channel in 0..<3 {
                let a = Double(source[left + channel])
                let b = Double(source[right + channel])
                let common = (a + b) * 0.5
                output.pixels[left + channel] = UInt8(clamping: Int((common * (1 - t) + a * t).rounded()))
                output.pixels[right + channel] = UInt8(clamping: Int((common * (1 - t) + b * t).rounded()))
            }
        }
    }

    source = output.pixels
    let limitY = min(blendWidth, height / 2)
    for x in 0..<width {
        for distance in 0..<limitY {
            let t = Double(distance) / Double(max(1, limitY - 1))
            let top = (distance * width + x) * 4
            let bottom = ((height - 1 - distance) * width + x) * 4
            for channel in 0..<3 {
                let a = Double(source[top + channel])
                let b = Double(source[bottom + channel])
                let common = (a + b) * 0.5
                output.pixels[top + channel] = UInt8(clamping: Int((common * (1 - t) + a * t).rounded()))
                output.pixels[bottom + channel] = UInt8(clamping: Int((common * (1 - t) + b * t).rounded()))
            }
        }
    }
    return output
}

func tiled(_ input: Raster, width: Int, height: Int) -> Raster {
    var pixels = [UInt8](repeating: 255, count: width * height * 4)
    for y in 0..<height {
        for x in 0..<width {
            let source = ((y % input.height) * input.width + (x % input.width)) * 4
            let target = (y * width + x) * 4
            pixels[target] = input.pixels[source]
            pixels[target + 1] = input.pixels[source + 1]
            pixels[target + 2] = input.pixels[source + 2]
            pixels[target + 3] = 255
        }
    }
    return Raster(width: width, height: height, pixels: pixels)
}

func cropped(_ input: Raster, x: Int, y: Int, width: Int, height: Int) -> Raster {
    precondition(x >= 0 && y >= 0 && x + width <= input.width && y + height <= input.height)
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    for row in 0..<height {
        let sourceStart = ((y + row) * input.width + x) * 4
        let targetStart = row * width * 4
        pixels[targetStart..<(targetStart + width * 4)] = input.pixels[sourceStart..<(sourceStart + width * 4)]
    }
    return Raster(width: width, height: height, pixels: pixels)
}

func normalMap(_ input: Raster, strength: Double) -> Raster {
    let width = input.width
    let height = input.height
    func wrapped(_ value: Int, limit: Int) -> Int { (value % limit + limit) % limit }
    func luminance(_ x: Int, _ y: Int) -> Double {
        var total = 0.0
        for oy in -1...1 {
            for ox in -1...1 {
                let px = wrapped(x + ox, limit: width)
                let py = wrapped(y + oy, limit: height)
                let index = (py * width + px) * 4
                let r = Double(input.pixels[index]) / 255.0
                let g = Double(input.pixels[index + 1]) / 255.0
                let b = Double(input.pixels[index + 2]) / 255.0
                total += r * 0.2126 + g * 0.7152 + b * 0.0722
            }
        }
        return total / 9.0
    }

    var heights = [Double](repeating: 0, count: width * height)
    for y in 0..<height {
        for x in 0..<width { heights[y * width + x] = luminance(x, y) }
    }
    func h(_ x: Int, _ y: Int) -> Double {
        heights[wrapped(y, limit: height) * width + wrapped(x, limit: width)]
    }

    var pixels = [UInt8](repeating: 255, count: width * height * 4)
    for y in 0..<height {
        for x in 0..<width {
            let gx = -h(x - 1, y - 1) + h(x + 1, y - 1)
                   - 2 * h(x - 1, y) + 2 * h(x + 1, y)
                   - h(x - 1, y + 1) + h(x + 1, y + 1)
            let gy = -h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)
                   + h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)
            var nx = -gx * strength
            var ny = -gy * strength
            var nz = 1.0
            let length = sqrt(nx * nx + ny * ny + nz * nz)
            nx /= length; ny /= length; nz /= length
            let index = (y * width + x) * 4
            pixels[index] = UInt8(clamping: Int(((nx * 0.5 + 0.5) * 255).rounded()))
            pixels[index + 1] = UInt8(clamping: Int(((ny * 0.5 + 0.5) * 255).rounded()))
            pixels[index + 2] = UInt8(clamping: Int(((nz * 0.5 + 0.5) * 255).rounded()))
            pixels[index + 3] = 255
        }
    }
    return Raster(width: width, height: height, pixels: pixels)
}

func edgeMAD(_ raster: Raster) -> (Double, Double) {
    var horizontal = 0.0
    var vertical = 0.0
    for y in 0..<raster.height {
        let left = (y * raster.width) * 4
        let right = (y * raster.width + raster.width - 1) * 4
        for channel in 0..<3 { horizontal += abs(Double(raster.pixels[left + channel]) - Double(raster.pixels[right + channel])) }
    }
    for x in 0..<raster.width {
        let top = x * 4
        let bottom = ((raster.height - 1) * raster.width + x) * 4
        for channel in 0..<3 { vertical += abs(Double(raster.pixels[top + channel]) - Double(raster.pixels[bottom + channel])) }
    }
    return (horizontal / Double(raster.height * 3), vertical / Double(raster.width * 3))
}

func run() throws {
    let args = CommandLine.arguments
    guard args.count >= 3 else {
        throw SurfaceError.invalidArguments("Usage: surface_processor.swift <albedo|acoustic|normal|cookie|metrics> <input> [output] [strength]")
    }
    let command = args[1]
    let input = args[2]
    switch command {
    case "albedo":
        guard args.count >= 4 else { throw SurfaceError.invalidArguments("albedo requires input and output") }
        let raster = try loadRaster(input, width: 1024, height: 1024)
        try write(blendSeams(raster, width: 16), to: args[3], jpegQuality: 0.9)
    case "acoustic":
        guard args.count >= 4 else { throw SurfaceError.invalidArguments("acoustic requires input and output") }
        let sixPanels = blendSeams(try loadRaster(input, width: 768, height: 768), width: 12)
        try write(tiled(sixPanels, width: 1024, height: 1024), to: args[3], jpegQuality: 0.9)
    case "normal":
        guard args.count >= 4 else { throw SurfaceError.invalidArguments("normal requires input and output") }
        let strength = args.count >= 5 ? (Double(args[4]) ?? 0.5) : 0.5
        let raster = try loadRaster(input, width: 512, height: 512)
        try write(normalMap(raster, strength: strength), to: args[3])
    case "cookie":
        guard args.count >= 4 else { throw SurfaceError.invalidArguments("cookie requires input and output") }
        let raster = try loadRaster(input)
        let quadrant = cropped(raster, x: 0, y: 0, width: raster.width / 2, height: raster.height / 2)
        try write(try rasterize(cgImage(quadrant), width: 512, height: 512), to: args[3])
    case "metrics":
        let raster = try loadRaster(input)
        let mad = edgeMAD(raster)
        print(String(format: "leftRight=%.3f topBottom=%.3f", mad.0, mad.1))
    default:
        throw SurfaceError.invalidArguments("Unknown command: \(command)")
    }
}

do {
    try run()
} catch {
    FileHandle.standardError.write(Data("surface_processor: \(error)\n".utf8))
    exit(1)
}
