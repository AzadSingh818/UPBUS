"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getState = getState;
exports.setState = setState;
exports.clearState = clearState;
// Map keyed by busId
const stateMap = new Map();
function getState(busId) {
    return stateMap.get(busId);
}
function setState(state) {
    stateMap.set(state.busId, state);
}
/** Reset state for a bus (e.g., when trip ends) */
function clearState(busId) {
    stateMap.delete(busId);
}
