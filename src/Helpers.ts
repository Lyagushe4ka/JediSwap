import { Account, AllowArray, Call, CallData, Calldata, InvokeFunctionResponse, InvokeTransactionReceiptResponse, RpcProvider, ec, hash, num } from "starknet";
import { STARKNET_RPC_URL } from "../Dependencies";

export const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });

export const ROUTER_JEDISWAP = '0x041fd22b238fa21cfcf5dd45a8548974d8263b3a531a60388411c5e230f97023';
export const FACTORY_JEDISWAP = '0x00dad44c139a476c7a17fc8141e6db680e9abc9f56fe249a105094c44382c2fd';

export const STARK_ETH_ADDRESS = '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

export const AX_PROXY_CLASS_HASH = "0x25ec026985a3bf9d0cc1fe17326b245dfdc3ff89b8fde106542a3ea56c5a918";
export const AX_ACCOUNT_CLASS_HASH = "0x033434ad846cdd5f23eb73ff09fe6fddd568284a0fb7d1be20ee482f044dabe2";

export const AX_ACCOUNT_CLASS_HASH_CAIRO_1 = '0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003';

export const BraavosProxyClassHash = '0x03131fa018d520a037686ce3efddeab8f28895662f019ca3ca18a626650f7d1e';
export const BraavosInitialClassHash = '0x5aa23d5bb71ddaa783da7ea79d405315bafa7cf0387a74f4593578c3e9e6570';

export type StarknetAccount = 'Argent' | 'Braavos';

export type StarkAccountData = {
  type: StarknetAccount;
  address: string;
}
type TimeSeparated = {
  seconds?: number;
  minutes?: number;
  hours?: number;
};

export function calculateArgentxAddress(privateKey: string): string {

  const starkPublicKeyAX = ec.starkCurve.getStarkKey(privateKey);

  const AXproxyConstructorCallData = CallData.compile(
    {
      implementation: AX_ACCOUNT_CLASS_HASH,
      selector: hash.getSelectorFromName("initialize"),
      calldata: CallData.compile({ signer: starkPublicKeyAX, guardian: "0" }),
    }
  );

  const AXcontractAddress = hash.calculateContractAddressFromHash(
    starkPublicKeyAX,
    AX_PROXY_CLASS_HASH,
    AXproxyConstructorCallData,
    0,
  );

  return AXcontractAddress;
}

export function calculateBraavosAddress(privateKey: string): string {
  const calcBraavosInit = (starkKeyPubBraavos: string) =>
  CallData.compile({ public_key: starkKeyPubBraavos });
const BraavosProxyConstructor = (BraavosInitializer: Calldata) =>
  CallData.compile({
    implementation_address: BraavosInitialClassHash,
    initializer_selector: hash.getSelectorFromName('initializer'),
    calldata: [...BraavosInitializer],
  });

  const starkKeyPubBraavos = ec.starkCurve.getStarkKey(num.toHex(privateKey));
  const BraavosInitializer = calcBraavosInit(starkKeyPubBraavos);
  const BraavosProxyConstructorCallData = BraavosProxyConstructor(BraavosInitializer);

  const address = hash.calculateContractAddressFromHash(
    starkKeyPubBraavos,
    BraavosProxyClassHash,
    BraavosProxyConstructorCallData,
    0
  );

  return address;
}

export function starkCreateSigner(privateKey: string, type: StarknetAccount): Account {

  const address = type === 'Argent' ? calculateArgentxAddress(privateKey) : calculateBraavosAddress(privateKey);

  const signer = new Account(provider, address, privateKey, type === 'Argent' ? '1' : '0');

  return signer;
}

export const sleep = async (from: TimeSeparated, to?: TimeSeparated): Promise<void> => {
  const seconds = from.seconds || 0;
  const minutes = from.minutes || 0;
  const hours = from.hours || 0;
  const msFrom = seconds * 1000 + minutes * 60 * 1000 + hours * 60 * 60 * 1000;
  if (to) {
    const seconds = to.seconds || 0;
    const minutes = to.minutes || 0;
    const hours = to.hours || 0;
    const msTo = seconds * 1000 + minutes * 60 * 1000 + hours * 60 * 60 * 1000;
    const ms = Math.floor(Math.random() * (msTo - msFrom + 1) + msFrom);
    console.log(`Sleeping for ${(ms / (1000 * 60)).toFixed(1)} minutes`);
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  return new Promise(resolve => setTimeout(resolve, msFrom));
};

export async function retry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  timeoutInSec = 6,
  logger?: (text: string) => Promise<any>,
): Promise<T> {
  let response: T;
  while (attempts--) {
    if (attempts === Number.MAX_SAFE_INTEGER - 1) {
      attempts = Number.MAX_SAFE_INTEGER;
    }
    try {
      response = await fn();
      break;
    } catch (e: unknown) {
      if (e instanceof Error) {
        const text = `[RETRY] Error while executing function. Message: ${e.message}. Attempts left: ${attempts === Number.MAX_SAFE_INTEGER ? 'infinity' : attempts}`;
        console.log(text);
        if (logger) {
          await logger(text);
        }
      } else {
        const text = `[RETRY] An unexpected error occurred. Attempts left: ${attempts === Number.MAX_SAFE_INTEGER ? 'infinity' : attempts}`;
        console.log(text);
        if (logger) {
          await logger(text);
        }
      }
      if (attempts === 0) {
        throw e;
      }
      await sleep({ seconds: timeoutInSec });
    }
  }
  return response!;
}

export async function starkExecuteCalls(
  signer: Account,
  callsArray: AllowArray<Call>,
  errorsArray?: Array<string>
): Promise<InvokeFunctionResponse | Error> {

  const nonce = await signer.getNonce();

  let tx: InvokeFunctionResponse | undefined;
  let tries = 5;
  while (!tx && --tries) {
    try {
      tx = await signer.execute(callsArray, undefined, { nonce });
    } catch (e: any) {
      if (e.message.includes('nonce')) {
        return new Error('Could not parse nonce');
      }
      if (errorsArray && errorsArray.some(err => e.message.includes(err))) {
        return new Error(e.message);
      }
      continue;
    }
  }

  if (!tx) {
    return new Error('Tx execution failed');
  }

  return tx;
}

export async function starkTxWaitingRoom(txHash: string, tries = 6, interval = 3): Promise<InvokeTransactionReceiptResponse | Error> {

  let receipt: InvokeTransactionReceiptResponse | undefined;
  while (!receipt && --tries) {
    receipt = await Promise.race([
      provider.waitForTransaction(txHash) as Promise<InvokeTransactionReceiptResponse>,
      sleep({ minutes: interval }).then(() => undefined),
    ])
  }

  if (!receipt || !receipt.transaction_hash) {
    return new Error('Could not get transaction receipt');
  }

  return receipt;
}