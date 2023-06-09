import {
  AztecSdk,
  createAztecSdk,
  EthAddress,
  GrumpkinAddress,
  toBaseUnits,
  TxSettlementTime,
  WalletProvider,
} from '@aztec/sdk';
import { EventEmitter } from 'events';
import { createFundedWalletProvider } from './create_funded_wallet_provider.js';
import { jest } from '@jest/globals';

jest.setTimeout(20 * 60 * 1000);
EventEmitter.defaultMaxListeners = 30;

const {
  ETHEREUM_HOST = 'http://localhost:8545',
  ROLLUP_HOST = 'http://localhost:8081',
  PRIVATE_KEY = '',
} = process.env;

/**
 * This simple deposit is run with the prover enabled in the e2e-prover test in CI.
 *
 * Run the following:
 * contracts: ./scripts/start_e2e.sh
 * kebab: ./scripts start_e2e_prover.sh
 * halloumi: ./scripts start_e2e_prover.sh
 * falafel: ./scripts start_e2e_prover.sh
 * end-to-end: yarn test e2e_deposit.test.ts
 *
 * If running real prover via docker:
 * end-to-end: ONLY_TARGET=false ../../bootstrap_docker.sh
 * end-to-end: TEST=e2e_deposit.test.ts NUM_INNER_ROLLUP_TXS=1 NUM_OUTER_ROLLUP_PROOFS=1 VK=VerificationKey1x1 PROVERLESS=false docker-compose -f ./scripts/docker-compose.yml up --force-recreate --exit-code-from end-to-end
 */

describe('end-to-end deposit test', () => {
  let provider: WalletProvider;
  let sdk: AztecSdk;
  let depositor: EthAddress;
  let userId!: GrumpkinAddress;
  const awaitSettlementTimeout = 600;

  beforeAll(async () => {
    provider = await createFundedWalletProvider(
      ETHEREUM_HOST,
      1,
      1,
      Buffer.from(PRIVATE_KEY, 'hex'),
      toBaseUnits('0.035', 18),
    );
    [depositor] = provider.getAccounts();

    sdk = await createAztecSdk(provider, {
      serverUrl: ROLLUP_HOST,
      pollInterval: 1000,
      memoryDb: true,
      minConfirmation: 1,
    });
    await sdk.run();
    await sdk.awaitSynchronised();

    const accountKey = await sdk.generateAccountKeyPair(depositor);
    const user = await sdk.addUser(accountKey.privateKey);
    userId = user.id;
  });

  afterAll(async () => {
    await sdk.destroy();
  });

  it('should deposit', async () => {
    const assetId = 0;
    const depositValue = sdk.toBaseUnits(assetId, '0.03');

    expect((await sdk.getBalance(userId, assetId)).value).toBe(0n);

    const fee = (await sdk.getDepositFees(assetId))[TxSettlementTime.INSTANT];
    const controller = sdk.createDepositController(depositor, depositValue, fee, userId);
    await controller.createProof();

    await controller.depositFundsToContract();
    await controller.awaitDepositFundsToContract();

    await controller.sign();
    await controller.send();
    await controller.awaitSettlement(awaitSettlementTimeout);

    expect(await sdk.getBalance(userId, assetId)).toEqual(depositValue);
  });
});
