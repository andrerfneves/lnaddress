import { resolve } from "../../src";
import { alice, create_mock_lnurl_fetch } from "./mock-provider";

const fetch = create_mock_lnurl_fetch();
const pay_request = await resolve(alice, { fetch });

console.log({
  callback: pay_request.callback,
  description: pay_request.description,
  min_sendable_msat: pay_request.min_sendable_msat.toString(),
  max_sendable_msat: pay_request.max_sendable_msat.toString(),
  metadata_hash: pay_request.metadata_hash,
});
