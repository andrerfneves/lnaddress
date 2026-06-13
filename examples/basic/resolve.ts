import { resolve } from "../../src";
import { alice, createMockLnurlFetch } from "./mock-provider";

const fetch = createMockLnurlFetch();
const payRequest = await resolve(alice, { fetch });

console.log({
  callback: payRequest.callback,
  description: payRequest.description,
  minSendableMsat: payRequest.minSendableMsat.toString(),
  maxSendableMsat: payRequest.maxSendableMsat.toString(),
  metadataHash: payRequest.metadataHash,
});
