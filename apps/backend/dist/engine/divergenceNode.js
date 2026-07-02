"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDivergenceNodes = loadDivergenceNodes;
/** Load divergence nodes from the mock DB (data.json). */
function loadDivergenceNodes() {
    // Dynamically require to avoid circular dependencies
    const mockDb = require('../db/data.json');
    return mockDb.divergence_nodes || [];
}
