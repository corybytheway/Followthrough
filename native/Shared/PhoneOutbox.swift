// Created by Cory McCabe
import Foundation

/// Requests and Watch ownership receipts commit together in one atomic write.
/// The optional receipt field keeps older saved outboxes readable.
struct CachedOutbox: Codable {
    var identity: String
    var operations: [PendingMutation]
    var acceptedWatchActions: [String]? = nil
}
