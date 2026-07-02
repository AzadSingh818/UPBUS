"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const routeLearning_1 = require("../engine/routeLearning");
const db_1 = require("../db");
exports.router = (0, express_1.Router)();
// 1. Ping location for a trip manually
exports.router.post('/ping', async (req, res) => {
    const { tripId, latitude, longitude, speed } = req.body;
    if (!tripId || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'tripId, latitude, and longitude are required' });
    }
    try {
        await (0, routeLearning_1.recordLiveLocation)(parseInt(tripId, 10), parseFloat(latitude), parseFloat(longitude), parseFloat(speed || 0));
        const currentVisited = routeLearning_1.visitedStopsMap.get(parseInt(tripId, 10)) || [];
        res.json({ success: true, currentVisited });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 2. Complete trip and force learning manually
exports.router.post('/complete', async (req, res) => {
    const { tripId } = req.body;
    if (!tripId) {
        return res.status(400).json({ error: 'tripId is required' });
    }
    try {
        await (0, routeLearning_1.completeTripAndLearnRoute)(parseInt(tripId, 10));
        res.json({ success: true, message: `Completed and processed trip ${tripId}` });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 3. Get visited stops for a specific trip
exports.router.get('/visited', async (req, res) => {
    const tripIdStr = req.query.tripId;
    if (!tripIdStr) {
        return res.status(400).json({ error: 'tripId is required as query parameter' });
    }
    const tripId = parseInt(tripIdStr, 10);
    const visitedStopIds = routeLearning_1.visitedStopsMap.get(tripId) || [];
    try {
        const stopsRes = await (0, db_1.query)('SELECT id, name, latitude, longitude FROM stops');
        const stopsById = new Map(stopsRes.rows.map(s => [s.id, s]));
        const traversed = visitedStopIds.map(id => stopsById.get(id)).filter(Boolean);
        res.json({ tripId, visitedStopIds, traversed });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 4. Get all currently tracked trips
exports.router.get('/visited/all', (req, res) => {
    const all = {};
    for (const [tripId, visited] of routeLearning_1.visitedStopsMap.entries()) {
        all[tripId] = visited;
    }
    res.json({ trackedTrips: all });
});
