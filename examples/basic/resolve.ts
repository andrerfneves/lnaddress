import { resolve } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });

console.log({
  callback: pay_request.callback,
  description: pay_request.description,
  minSendableMsat: pay_request.minSendableMsat.toString(),
  maxSendableMsat: pay_request.maxSendableMsat.toString(),
  metadataHash: pay_request.metadataHash,
});
