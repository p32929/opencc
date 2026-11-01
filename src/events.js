// One process runs both the panel and the proxy (src/cli.js), so the panel
// can be told about a request the moment it is served instead of polling for
// it. Nothing subscribes when the proxy runs on its own, and an emit with no
// listeners costs nothing.
import { EventEmitter } from "node:events";

export const bus = new EventEmitter();
// The panel opens one listener per browser tab; the default cap of 10 would
// start printing warnings at the eleventh.
bus.setMaxListeners(100);
