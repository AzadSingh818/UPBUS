import { Request, Response } from 'express';
import { RouteProgressService } from '../service/RouteProgressService';

export class RouteProgressController {
  static async getProgress(req: Request, res: Response) {
    try {
      const busId = parseInt(req.params.busId, 10);
      if (isNaN(busId)) {
        return res.status(400).json({ error: 'Parameters "busId" must be a valid integer.' });
      }

      const progress = await RouteProgressService.getProgress(busId);
      if (!progress) {
        return res.status(404).json({ error: 'No progress updates found or no active trip for this bus.' });
      }

      res.json(progress);
    } catch (error: any) {
      console.error('[RouteProgressController] Error fetching progress:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
