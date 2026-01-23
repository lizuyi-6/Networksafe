import { Router } from 'express';
import simulationService from '../../services/simulation.service';

const router = Router();

router.get('/', (req, res) => {
    res.json(simulationService.getStats());
});

export default router;
