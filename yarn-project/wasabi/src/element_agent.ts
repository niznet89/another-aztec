import {
  AssetValue,
  AztecSdk,
  DefiController,
  DefiSettlementTime,
  toBaseUnits,
  TxSettlementTime,
  WalletProvider,
} from '@aztec/sdk';
import { Agent, EthAddressAndNonce, UserData } from './agent.js';
import { AgentElementConfig, buildBridgeCallData, formatTime, ELEMENT_BRIDGE_ADDRESS_ID } from './bridges.js';

export enum ElementState {
  RUNNING,
  CHECKPOINT,
  COMPLETE,
}
export class ElementAgent {
  private agent: Agent;
  private user?: UserData;
  private state: ElementState;
  public controllers: DefiController[] = [];
  public originalAssetValues: AssetValue[] = [];

  constructor(
    fundingAccount: EthAddressAndNonce,
    private sdk: AztecSdk,
    provider: WalletProvider,
    private id: number,
    private numDepositsPerExpiry: number,
    private elementConfig: AgentElementConfig[],
    private expiryCheckpoints: number[],
  ) {
    this.agent = new Agent(fundingAccount, sdk, provider, id);
    this.state = ElementState.RUNNING;
  }

  public static async create(
    fundingAccount: EthAddressAndNonce,
    sdk: AztecSdk,
    provider: WalletProvider,
    id: number,
    numDepositsPerExpiry: number,
    elementConfig: AgentElementConfig[],
    expiryCheckpoints: number[],
  ) {
    const agent = new ElementAgent(
      fundingAccount,
      sdk,
      provider,
      id,
      numDepositsPerExpiry,
      elementConfig,
      expiryCheckpoints,
    );
    await agent.init();
    return agent;
  }

  public updateAssetQuantites(elementConfig: AgentElementConfig[]) {
    for (const config of elementConfig) {
      const assetValueIndex = this.originalAssetValues.findIndex(x => x.assetId == config.assetId);
      if (assetValueIndex == -1) {
        this.originalAssetValues.push({ assetId: config.assetId, value: config.assetQuantity });
      } else {
        this.originalAssetValues[assetValueIndex].value += config.assetQuantity;
      }
    }
  }

  public async init() {
    this.user = await this.agent.createUser();
  }

  public async getRequiredFunding() {
    return await Promise.resolve(toBaseUnits('0.1', 18));
  }

  public isOnCheckpoint() {
    return this.state == ElementState.CHECKPOINT;
  }

  public triggerNextCheckpoint() {
    this.state = ElementState.RUNNING;
  }

  private async blockOnCheckpoint() {
    this.state = ElementState.CHECKPOINT;
    while (this.isOnCheckpoint()) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
    }
  }

  private async makeAllDeposits() {
    await (
      await this.agent.sendDeposit(this.user!.address, this.user!, await this.calcEthDeposit())
    )?.awaitSettlement();
    const depositControllers = [];
    for (const assetValue of this.originalAssetValues) {
      const controller = await this.agent.sendDeposit(
        this.user!.address,
        this.user!,
        assetValue.value,
        assetValue.assetId,
        false,
        undefined,
        { userId: this.user!.user.id, signer: this.user!.signer },
      );
      depositControllers.push(controller);
    }
    await this.agent.awaitBulkSettlement(depositControllers);
  }

  private async makeWithdrawals() {
    await (await this.agent.sendWithdraw(this.user!))?.awaitSettlement();
  }

  public async run() {
    try {
      const deposit = await this.getRequiredFunding();
      await this.agent.fundEthAddress(this.user!, deposit);
      for (const config of this.elementConfig) {
        await this.agent.fundEthAddress(this.user!, config.assetQuantity, config.assetId);
      }
      await this.makeAllDeposits();
      console.log(`agent ${this.id} aztec deposits completed!`);
      let checkpointIndex = 0;
      for (let i = 0; i < this.elementConfig.length; i++) {
        const config = this.elementConfig[i];
        if (
          checkpointIndex < this.expiryCheckpoints.length &&
          config.expiry! > this.expiryCheckpoints[checkpointIndex]
        ) {
          console.log(
            `agent ${this.id} at checkpoint ${this.expiryCheckpoints[checkpointIndex]}, next expiry ${config.expiry}`,
          );
          await this.blockOnCheckpoint();
          checkpointIndex++;
          console.log(
            `agent ${this.id} released from checkpoint ${this.expiryCheckpoints[checkpointIndex]}, next expiry ${config.expiry}`,
          );
        }
        const depositValue = config.assetQuantity / BigInt(this.numDepositsPerExpiry * 2);
        if (!depositValue) {
          console.log(`agent ${this.id} deposit value of 0!!`);
        }
        const newControllers = [];
        for (let i = 0; i < this.numDepositsPerExpiry; i++) {
          console.log(`agent ${this.id} making element deposit ${i + 1} of ${this.numDepositsPerExpiry}`);
          const controller = await this.makeElementDeposit(config.assetId, config.expiry!, depositValue);
          newControllers.push(controller);
        }
        await Promise.all(newControllers.map(c => c.awaitDefiDepositCompletion()));
        this.controllers.push(...newControllers);
      }
      console.log(`agent ${this.id} completed element deposits`);
      // block on checkpoint one last time
      await this.blockOnCheckpoint();
      console.log(`agent ${this.id} awaiting settlements`);
      await this.agent.awaitBulkSettlement(this.controllers);
      await this.measureBalances();

      await this.makeWithdrawals();
    } catch (err: any) {
      console.log(`ERROR: `, err);
    }
  }

  private async getDefiFee(
    assetId: number,
    expiry: bigint,
    settlementTime: DefiSettlementTime = DefiSettlementTime.DEADLINE,
  ) {
    const fee = (await this.sdk.getDefiFees(buildBridgeCallData(ELEMENT_BRIDGE_ADDRESS_ID, assetId, assetId, expiry)))[
      settlementTime
    ];
    const jsFee = (await this.sdk.getTransferFees(fee.assetId))[TxSettlementTime.NEXT_ROLLUP];
    return { ...fee, value: fee.value + jsFee.value };
  }

  private async measureBalances() {
    for (const assetValue of this.originalAssetValues) {
      const balance = await this.sdk.getBalance(this.user!.user.id, assetValue.assetId);
      const asset = this.sdk.getAssetInfo(assetValue.assetId);
      const originalBalance = assetValue.value;
      console.log(
        `agent ${this.id} asset ${asset.name} original balance ${originalBalance}, final balance ${balance.value}`,
      );
    }
  }

  private async calcEthDeposit() {
    const assetFees = (
      await Promise.all(
        this.elementConfig.map(async config => {
          const assetDepositFee = (await this.sdk.getDepositFees(config.assetId))[TxSettlementTime.NEXT_ROLLUP].value;
          const assetWithdrawFee = (await this.sdk.getWithdrawFees(config.assetId))[TxSettlementTime.NEXT_ROLLUP].value;
          const fee = await this.getDefiFee(config.assetId, config.expiry!);
          return fee.value * BigInt(this.numDepositsPerExpiry) + assetDepositFee + assetWithdrawFee;
        }),
      )
    ).reduce((p, c) => p + c, 0n);
    const ethDepositFee = (await this.sdk.getDepositFees(0))[TxSettlementTime.NEXT_ROLLUP].value;
    const ethWithdrawFee = (await this.sdk.getWithdrawFees(0))[TxSettlementTime.NEXT_ROLLUP].value;
    return assetFees + ethDepositFee + ethWithdrawFee;
  }

  private async singleDefiDeposit(assetId: number, expiry: bigint, deposit: bigint) {
    const bridgeCallData = buildBridgeCallData(ELEMENT_BRIDGE_ADDRESS_ID, assetId, assetId, expiry);
    const fee = await this.getDefiFee(assetId, expiry);
    const inputAssetInfo = this.sdk.getAssetInfo(assetId);
    console.log(
      `agent ${this.id} depositing ${deposit} of asset ${inputAssetInfo.name} with expiry ${formatTime(
        Number(expiry),
      )} with fee ${fee.value}`,
    );
    const controller = this.sdk.createDefiController(
      this.user!.user.id,
      this.user!.signer,
      bridgeCallData,
      { assetId: assetId, value: deposit },
      fee,
    );
    await controller.createProof();
    await controller.send();
    return controller;
  }

  private async makeElementDeposit(assetId: number, expiry: bigint, deposit: bigint) {
    while (true) {
      try {
        return await this.singleDefiDeposit(assetId, expiry, deposit);
      } catch (err) {
        console.log(`agent ${this.id} failed to make element deposit`, err);
        await new Promise<void>(resolve => setTimeout(() => resolve(), 10000));
      }
    }
  }
}
