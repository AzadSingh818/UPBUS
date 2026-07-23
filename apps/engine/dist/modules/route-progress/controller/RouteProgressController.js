"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteProgressController = void 0;
const RouteProgressService_1 = require("../service/RouteProgressService");
class RouteProgressController {
    static async getProgress(req, res) {
        try {
            const busId = parseInt(req.params.busId, 10);
            if (isNaN(busId)) {
                return res.status(400).json({ error: 'Parameters "busId" must be a valid integer.' });
            }
            const progress = await RouteProgressService_1.RouteProgressService.getProgress(busId);
            if (!progress) {
                return res.status(404).json({ error: 'No progress updates found or no active trip for this bus.' });
            }
            res.json(progress);
        }
        catch (error) {
            console.error('[RouteProgressController] Error fetching progress:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}
exports.RouteProgressController = RouteProgressController;
