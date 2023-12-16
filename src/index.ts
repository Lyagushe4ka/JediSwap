import { CallData, Contract, cairo, uint256 } from "starknet";
import { AMOUNT, PRIVATE_KEY, SHITCOIN_ADDRESS, SLIPPAGE, WALLET_TYPE } from "../Dependencies";
import { FACTORY_JEDISWAP, ROUTER_JEDISWAP, STARK_ETH_ADDRESS, retry, starkCreateSigner, starkExecuteCalls, starkTxWaitingRoom } from "./Helpers";
import { parseEther } from "ethers";
import { erc20Abi, jediswapFactoryABi, jediswapPoolABI, jediswapRouterABi } from "./ABI";


async function main() {

  const signer = starkCreateSigner(PRIVATE_KEY, WALLET_TYPE);
  console.log('Wallet address: ', signer.address);

  const tokenInstance = new Contract(erc20Abi, STARK_ETH_ADDRESS, signer);
  const routerInstance = new Contract(jediswapRouterABi, ROUTER_JEDISWAP, signer);
  const factoryInstance = new Contract(jediswapFactoryABi, FACTORY_JEDISWAP, signer);

  const poolAddressData: any = await retry(() => factoryInstance.get_pair(STARK_ETH_ADDRESS, SHITCOIN_ADDRESS));
  const poolAddress = '0x' + poolAddressData.pair.toString(16);
  const poolInstance = new Contract(jediswapPoolABI, poolAddress, signer);

  const token0: any = await retry(() => poolInstance.token0());
  const token0Address = '0x' + token0.address.toString(16);
  const reservesData: any = await retry(() => poolInstance.get_reserves());
  const reserve0 = uint256.uint256ToBN(reservesData.reserve0);
  const reserve1 = uint256.uint256ToBN(reservesData.reserve1);

  const slippage = (100n - BigInt(SLIPPAGE)) <= 0n ? 1n : 100n - BigInt(SLIPPAGE);
  const amount = cairo.uint256(parseEther(AMOUNT));
  const amountOut = token0Address === STARK_ETH_ADDRESS ? reserve1 * parseEther(AMOUNT) / reserve0 : reserve0 * parseEther(AMOUNT) / reserve1;
  const amountOutMin = cairo.uint256(amountOut / 100n * slippage);

  const approveCall = {
    contractAddress: tokenInstance.address,
    entrypoint: "approve",
    calldata: CallData.compile({
      spender: routerInstance.address,
      amount,
    })
  }

  const swapCall = {
    contractAddress: routerInstance.address,
    entrypoint: "swap_exact_tokens_for_tokens" ,
    calldata: CallData.compile({
      amountIn: amount,
      amountOutMin,
      path: [STARK_ETH_ADDRESS, SHITCOIN_ADDRESS],
      to: signer.address,
      deadline: Date.now() + 1000 * 60 * 2,
    })
  }

  const calls = [approveCall, swapCall];

  const tx = await starkExecuteCalls(signer, calls);

  if (tx instanceof Error) {
    throw tx;
  }

  const receipt = await starkTxWaitingRoom(tx.transaction_hash);

  if (receipt instanceof Error) {
    throw receipt;
  }

  console.log('TX hash: ', receipt.transaction_hash);

  return;
}

main();