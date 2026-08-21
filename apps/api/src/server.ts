import { parseConfig } from './config.js';
import { bootstrapApplication } from './startup.js';

void bootstrapApplication(parseConfig());
