import { app } from "./app";
import { config } from "./lib/config";

app.listen(config.port, () => console.log(`Sathsangath API running on http://localhost:${config.port}/api/v1`));
