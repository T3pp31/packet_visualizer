import type { AppConfig } from '../core/types';
import appConfig from '../../config/app.config.json';

export function loadConfig(): AppConfig {
  return appConfig as AppConfig;
}
