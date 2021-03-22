import React from 'react';
import { Asset, ShieldFormValues, ShieldStatus, toBaseUnits } from '../../app';
import { Theme } from '../../styles';
import { AssetInfoRow } from './asset_info_row';
import { ProgressTemplate } from './progress_template';

interface ShieldProgressProps {
  theme: Theme;
  asset: Asset;
  assetPrice: bigint;
  form: ShieldFormValues;
  onGoBack(): void;
  onSubmit(): void;
  onClose(): void;
}

export const ShieldProgress: React.FunctionComponent<ShieldProgressProps> = ({
  theme,
  asset,
  assetPrice,
  form,
  onGoBack,
  onSubmit,
  onClose,
}) => {
  const { amount, fee, recipient, status, submit } = form;

  const items = [
    {
      title: 'Amount',
      content: <AssetInfoRow asset={asset} value={toBaseUnits(amount.value, asset.decimals)} price={assetPrice} />,
    },
    {
      title: 'Fee',
      content: <AssetInfoRow asset={asset} value={toBaseUnits(fee.value, asset.decimals)} price={assetPrice} />,
    },
    {
      title: 'Recipient',
      content: `@${recipient.value.input}`,
    },
  ];

  const steps = [
    {
      status: ShieldStatus.DEPOSIT,
      text: `Deposit ${asset.symbol}`,
    },
    {
      status: ShieldStatus.CREATE_PROOF,
      text: 'Create Proof',
    },
    {
      status: ShieldStatus.APPROVE_PROOF,
      text: 'Approve Proof',
    },
    {
      status: ShieldStatus.SEND_PROOF,
      text: 'Send Private Transaction',
    },
  ];

  return (
    <ProgressTemplate
      theme={theme}
      action="Shield"
      items={items}
      steps={steps}
      form={form as any}
      currentStatus={status.value}
      confirmStatus={ShieldStatus.CONFIRM}
      validateStatus={ShieldStatus.VALIDATE}
      doneStatus={ShieldStatus.DONE}
      message={submit.message}
      messageType={submit.messageType}
      onGoBack={onGoBack}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
};