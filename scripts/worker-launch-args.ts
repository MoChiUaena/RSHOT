// Return only safe launcher arguments; model credentials stay in the private file.
import { readLocalModel, workerLaunchArguments } from "./lib/local-model.ts";
const model = readLocalModel();
if (!model.ready) throw new Error("model-configuration-unavailable");
console.log(JSON.stringify(workerLaunchArguments(model.env.LLM_MODEL!)));
