// Created by Cory McCabe
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

struct PhotoTextResult: Sendable {
    var text: String
    var uncertain: Bool
    var imageData: Data? = nil
    var warning: String? = nil
    var isVisuallyBlank = false
}

enum PhotoTextExtractor {
    static let maximumImages = 5
    static let maximumBytes = 20 * 1024 * 1024
    static let supportedTypes: [UTType] = [.jpeg, .png, .heic, .heif]

    static func supportedType(for provider: NSItemProvider) -> String? {
        provider.registeredTypeIdentifiers.first { identifier in
            guard let type = UTType(identifier) else { return false }
            return supportedTypes.contains { type.conforms(to: $0) }
        }
    }

    static func extract(from provider: NSItemProvider, recognitionLevel: VNRequestTextRecognitionLevel = .accurate) async throws -> PhotoTextResult {
        guard let type = supportedType(for: provider) else {
            throw PhotoCaptureError.message("Use a JPEG, PNG, or HEIC photo.")
        }
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                guard let url else {
                    continuation.resume(throwing: error ?? PhotoCaptureError.message("The photo could not be loaded. Download it first, then share it again."))
                    return
                }
                // The provider's temporary file is valid only inside this callback.
                // Decode a bounded thumbnail here rather than loading full image data.
                do { continuation.resume(returning: try autoreleasepool { try extract(from: url, recognitionLevel: recognitionLevel) }) }
                catch { continuation.resume(throwing: error) }
            }
        }
    }

    static func extract(from url: URL, recognitionLevel: VNRequestTextRecognitionLevel = .accurate) throws -> PhotoTextResult {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? maximumBytes + 1
        guard size <= maximumBytes else { throw PhotoCaptureError.message("This photo is larger than 20 MB. Share a smaller copy.") }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let identifier = CGImageSourceGetType(source), let type = UTType(identifier as String),
              supportedTypes.contains(where: { type.conforms(to: $0) }),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 3072,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else { throw PhotoCaptureError.message("This photo could not be read. Use a JPEG, PNG, or HEIC image.") }
        let jpeg = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(jpeg, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw PhotoCaptureError.message("Could not prepare this photo for Apple Intelligence.")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw PhotoCaptureError.message("Could not save this photo.") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = recognitionLevel
        request.usesLanguageCorrection = recognitionLevel == .accurate
        request.automaticallyDetectsLanguage = recognitionLevel == .accurate
        do { try VNImageRequestHandler(cgImage: image).perform([request]) }
        catch { return PhotoTextResult(text: "", uncertain: true, imageData: jpeg as Data, warning: "OCR was unavailable. Apple Intelligence can still interpret the image.") }
        let candidates = (request.results ?? []).compactMap { $0.topCandidates(1).first }
        let text = candidates.map(\.string).joined(separator: "\n")
        guard text.utf16.count <= 16000 else {
            return PhotoTextResult(text: "", uncertain: true, imageData: jpeg as Data, warning: "There is too much text for the OCR fallback. The image is saved for Apple Intelligence.")
        }
        return PhotoTextResult(text: text, uncertain: candidates.contains { $0.confidence < 0.65 }, imageData: jpeg as Data,
            isVisuallyBlank: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && looksBlank(image))
    }

    private static func looksBlank(_ image: CGImage) -> Bool {
        let side = 64
        guard let sample = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
              bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let pixels = sample.data?.assumingMemoryBound(to: UInt8.self) else { return false }
        sample.interpolationQuality = .high
        sample.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        var lows = [255, 255, 255]
        var highs = [0, 0, 0]
        for offset in stride(from: 0, to: side * side * 4, by: 4) {
            for channel in 0..<3 {
                let value = Int(pixels[offset + channel])
                lows[channel] = min(lows[channel], value)
                highs[channel] = max(highs[channel], value)
            }
        }
        // Keep text-free photos eligible unless the thumbnail is flat or nearly black.
        return highs.allSatisfy { $0 <= 16 } || zip(lows, highs).allSatisfy { $1 - $0 <= 4 }
    }
}
