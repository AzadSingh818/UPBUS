"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMBIGUITY_TIMEOUT_MS = exports.BRANCH_CONFIDENCE_MS = exports.BRANCH_MATCH_MARGIN_KM = exports.DIVERGENCE_PROXIMITY_KM = void 0;
// config.ts
exports.DIVERGENCE_PROXIMITY_KM = 0.5; // distance to start checking for branch match
exports.BRANCH_MATCH_MARGIN_KM = 0.4; // max perpendicular distance to consider a match
exports.BRANCH_CONFIDENCE_MS = 30_000; // 30 s sustained proximity
exports.AMBIGUITY_TIMEOUT_MS = 15_000; // abort ambiguous crossing after 15 s
