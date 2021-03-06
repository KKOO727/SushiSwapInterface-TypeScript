import { Currency, ETHER, ChainId, JSBI, Percent, ROUTER_ADDRESS, WETH, Trade } from '@sushiswap/sdk'
import React, { useCallback, useState, useEffect } from 'react'
import { Link, RouteComponentProps } from 'react-router-dom'
import styled, { ThemeContext, keyframes } from 'styled-components'
import { transparentize } from 'polished'
import { Text } from 'rebass'
import { ArrowLeft } from 'react-feather'
import { useDispatch } from 'react-redux'

import { BIPS_BASE, INITIAL_ALLOWED_SLIPPAGE } from '../../constants'
import { RowBetween, AutoRow, RowFixed } from '../../components/Row'
import { ButtonConfirmed, ButtonError, ButtonLight, ButtonPrimary } from '../../components/ButtonLegacy'
import Column, { AutoColumn } from '../../components/Column'
import CurrencyLogo from '../../components/CurrencyLogo'
import DoubleCurrencyLogo from '../../components/DoubleLogo'
import CurrencyInputPanel from '../../components/CurrencyInputPanel'
import Settings from '../../components/Settings'
import PoolList from './PoolList'
import Loader from '../../components/Loader'
import ProgressSteps from '../../components/ProgressSteps'

import { AppDispatch } from 'state'
import { useCurrency } from '../../hooks/Tokens'
import usePool from '../../hooks/queries/usePool'
import { useDerivedZapInfo, useZapActionHandlers, useZapState } from '../../state/zap/hooks'

import { TYPE } from '../../theme'
import { currencyId as getCurrencyId } from '../../utils/currencyId'
import { maxAmountSpend } from 'utils/maxAmountSpend'
import { useRouterContract } from 'hooks/useContract'
import { useActiveWeb3React } from 'hooks/useActiveWeb3React'
import { useWalletModalToggle } from 'state/application/hooks'
import useZapper from 'hooks/useZapper'
import { ApprovalState, useApproveCallback } from 'hooks/useApproveCallback'
import { computeTradePriceBreakdown, warningSeverity } from 'utils/prices'
import { resetZapState } from 'state/zap/actions'
import { useUserSlippageTolerance } from 'state/user/hooks'
import { getZapperAddress } from 'constants/addresses'
import { Alert, QuestionHelper } from 'components'
import { pool } from '@sushiswap/sushi-data/typings/masterchef'
import SwapRoute from 'components/swap/SwapRoute'
import FormattedPriceImpact from 'components/swap/FormattedPriceImpact'

const PoolAllocationWrapper = styled.div`
    margin-top: 1rem;
    background-color: ${({ theme }) => theme.bg1};
    border-radius: 0.625rem 0.625rem 0 0;
    padding: 1rem;
`

const PoolBreakDownWrapper = styled.div`
  background-color: ${({ theme }) => theme.bg1};
  border-top: 1px solid rgba(42, 58, 80, 0.4);
  padding: 1rem
  border-radius: 0 0 0.625rem 0.625rem;
`

const Tabs = styled.div`
    ${({ theme }) => theme.flexRowNoWrap}
    align-items: center;
    border-radius: 3rem;
    justify-content: space-evenly;
`

const StyledArrowLeft = styled(ArrowLeft)`
    color: ${({ theme }) => theme.text1};
`

const PoolTokenRow = styled.span`
    display: flex;
    margin: 10px 0;
`

const defaultHighlightColor = '#2b2f3e'
const defaultBaseColor = '#21262b'

const skeletonKeyframes = keyframes`
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: calc(200px + 100%) 0;
  }
`

const Skeleton = styled.span`
    background-color: ${defaultBaseColor};
    background-image: linear-gradient(90deg, ${defaultBaseColor}, ${defaultHighlightColor}, ${defaultBaseColor});
    background-size: 200px 100%;
    background-repeat: no-repeat;
    border-radius: 4px;
    animation: ${skeletonKeyframes} 2s infinite;
    display: inline-block;
    line-height: 1;
    width: 100%;
`

const CardHeader = () => {
    const dispatch = useDispatch<AppDispatch>()

    return (
        <AutoColumn>
            <RowBetween style={{ padding: '1rem 0rem 1rem' }}>
                <Link
                    to="/zap"
                    onClick={() => {
                        dispatch(resetZapState())
                    }}
                >
                    <StyledArrowLeft />
                </Link>
                <TYPE.mediumHeader fontWeight={500} fontSize="22px" style={{ marginBottom: '20px' }}>
                    Zap Liquidity
                </TYPE.mediumHeader>
                <Settings />
            </RowBetween>
            <RowBetween style={{ padding: '0rem 0rem 1rem' }}>
                <Alert
                    showIcon={true}
                    message={
                        <>
                            Zaps allow you to LP in any pool with any asset. Please be careful when zapping low
                            liquidity tokens as there may be very high slippage. ETH, WBTC, USDC, DAI and SUSHI are the
                            safest tokens to zap with. If price impact seems too high, try disabling multihop.
                        </>
                    }
                    type="warning"
                />
            </RowBetween>
        </AutoColumn>
    )
}

const AddSingleSideLiquidity = ({
    match: {
        params: { poolAddress, currencyId }
    },
    history
}: RouteComponentProps<{ poolAddress?: string; currencyId?: string }>) => {
    const { account, chainId } = useActiveWeb3React()

    const currency = useCurrency(currencyId)
    const { onFieldInput } = useZapActionHandlers(false)
    const {
        typedValue,
        currency0,
        currency1,
        token0,
        token1,
        poolTokenPercentage,
        currencyBalance,
        parsedAmount,
        error,
        bestTrade,
        liquidityMinted,
        currencyOneOutput,
        currencyZeroOutput,
        isTradingUnderlying,
        encodeSwapData
    } = useDerivedZapInfo(currency ?? undefined, poolAddress)
    const { zapIn } = useZapper(currency ?? undefined)
    const dispatch = useDispatch<AppDispatch>()

    const route = bestTrade?.route
    const noRoute = !route

    const { priceImpactWithoutFee } = computeTradePriceBreakdown(bestTrade)
    const priceImpactSeverity = warningSeverity(priceImpactWithoutFee)
    const zapperAddress = getZapperAddress(chainId)

    // // check whether the user has approved the router on the input token
    const [approval, approveCallback] = useApproveCallback(parsedAmount, zapperAddress)

    // check if user has gone through approval process, used to show two step buttons, reset on token change
    const [approvalSubmitted, setApprovalSubmitted] = useState<boolean>(false)

    // get custom setting values for user in bips
    const [allowedSlippage] = useUserSlippageTolerance()

    // Get min pooltokens received based on user slippage preferences
    const minTokensReceived = JSBI.divide(
        // Take raw token (number * (10000 - ALLOWED_SLIPPAGE))/10000
        JSBI.multiply(liquidityMinted?.raw || JSBI.BigInt(0), JSBI.BigInt(10000 - allowedSlippage)),
        JSBI.BigInt(10000)
    )

    // mark when a user has submitted an approval, reset onTokenSelection for input field
    useEffect(() => {
        if (approval === ApprovalState.PENDING) {
            setApprovalSubmitted(true)
        }
    }, [approval, approvalSubmitted])

    // show approve flow when: no error on inputs, not approved or pending, or approved in current session
    const showApproveFlow =
        !error &&
        (approval === ApprovalState.NOT_APPROVED ||
            approval === ApprovalState.PENDING ||
            (approvalSubmitted && approval === ApprovalState.APPROVED))

    const handleCurrencyASelect = useCallback(
        (currency: Currency) => {
            const newCurrencyId = getCurrencyId(currency)
            history.push(`/zap/${poolAddress}/${newCurrencyId}`)
        },
        [history, poolAddress]
    )

    const toggleWalletModal = useWalletModalToggle()

    const zapCallback = useCallback(() => {
        const swapData = encodeSwapData()

        zapIn(
            currency === ETHER ? '0x0000000000000000000000000000000000000000' : currencyId,
            poolAddress,
            parsedAmount,
            currency === ETHER && isTradingUnderlying
                ? WETH[chainId || 1].address
                : isTradingUnderlying
                ? poolAddress
                : ROUTER_ADDRESS[chainId || 1],
            minTokensReceived.toString(),
            swapData
        ).then(
            () => dispatch(resetZapState()),
            err => console.log(err, 'zap error')
        )
    }, [currency, poolAddress, chainId, parsedAmount, minTokensReceived])

    const showRoute = Boolean(bestTrade && bestTrade.route.path.length > 2)

    return (
        <>
            {!poolAddress ? (
                <PoolList />
            ) : (
                <div className="bg-dark-900 shadow-swap-blue-glow w-full max-w-xl rounded p-4">
                    <CardHeader />
                    <AutoColumn>
                        <CurrencyInputPanel
                            label={'From'}
                            showMaxButton={true}
                            onMax={() => {
                                onFieldInput(maxAmountSpend(currencyBalance)?.toExact() ?? '')
                            }}
                            value={typedValue ?? ''}
                            currency={currency}
                            onUserInput={onFieldInput}
                            onCurrencySelect={handleCurrencyASelect}
                            id="zap-currency-input"
                            cornerRadiusBottomNone={false}
                            showCommonBases
                        />
                        <PoolAllocationWrapper>
                            <RowBetween style={{ marginBottom: '12px' }}>
                                <TYPE.darkGray fontSize="14px">To</TYPE.darkGray>
                                {currency0 && currency1 ? (
                                    <DoubleCurrencyLogo
                                        currency0={currency0 ?? undefined}
                                        currency1={currency1 ?? undefined}
                                        margin={false}
                                        size={20}
                                    />
                                ) : (
                                    <Skeleton style={{ width: '60px', height: '20px' }} />
                                )}
                            </RowBetween>
                            <RowBetween>
                                <TYPE.subHeader fontWeight={500} fontSize="22px">
                                    {liquidityMinted?.toSignificant(6) || '0'}
                                </TYPE.subHeader>
                                <div className="inline-flex">
                                    {currency0 && currency1 ? (
                                        <>
                                            <TYPE.subHeader fontWeight={500} fontSize="22px">
                                                {`${currency0?.symbol}${' '}`}
                                            </TYPE.subHeader>
                                            <TYPE.darkGray fontWeight={500} fontSize="22px" className="mx-1">
                                                /
                                            </TYPE.darkGray>
                                            <TYPE.subHeader fontWeight={500} fontSize="22px">
                                                {`${' '}${currency1?.symbol}`}
                                            </TYPE.subHeader>
                                        </>
                                    ) : (
                                        <Skeleton style={{ width: '120px', height: '26px' }} />
                                    )}
                                </div>
                            </RowBetween>
                        </PoolAllocationWrapper>
                        <PoolBreakDownWrapper>
                            <RowBetween>
                                <div>
                                    <TYPE.darkGray fontSize="14px">Est. Pool Allocation</TYPE.darkGray>
                                    <PoolTokenRow>
                                        <CurrencyLogo
                                            size="22px"
                                            currency={currency0 ?? undefined}
                                            style={{ marginRight: '6px' }}
                                        />
                                        <TYPE.small fontSize="14px">
                                            {currencyZeroOutput?.toSignificant(6) || 0} {currency0?.symbol}
                                        </TYPE.small>
                                    </PoolTokenRow>
                                    <PoolTokenRow>
                                        <CurrencyLogo
                                            size="22px"
                                            currency={currency1 ?? undefined}
                                            style={{ marginRight: '6px' }}
                                        />
                                        <TYPE.small fontSize="14px">
                                            {currencyOneOutput?.toSignificant(6) || 0} {currency1?.symbol}
                                        </TYPE.small>
                                    </PoolTokenRow>
                                </div>
                                <div style={{ height: '91px' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                        <QuestionHelper text="Your share of the total liquidity pool" />
                                        <TYPE.darkGray textAlign="right" fontSize="14px" marginLeft="0.25rem">
                                            Pool Share
                                        </TYPE.darkGray>
                                    </span>
                                    <TYPE.small marginBottom="8px" textAlign="right" fontSize="14px">
                                        {poolTokenPercentage?.toSignificant(6) || '0'}%
                                    </TYPE.small>
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                        <QuestionHelper text="The difference between the market price and the estimated price due to trade size." />
                                        <TYPE.darkGray fontSize="14px" textAlign="right" marginLeft="0.25rem">
                                            Price Impact
                                        </TYPE.darkGray>
                                    </span>
                                    <TYPE.small textAlign="right" fontSize="14px">
                                        {/* bestTrade?.priceImpact */}
                                        <FormattedPriceImpact priceImpact={bestTrade?.priceImpact} />
                                    </TYPE.small>
                                </div>
                            </RowBetween>
                            {showRoute && (
                                <RowBetween style={{ padding: '16px 0 0 0' }}>
                                    <span style={{ display: 'flex', alignItems: 'center' }}>
                                        <div className="text-secondary text-sm">Route</div>
                                        <QuestionHelper text="Routing through these tokens resulted in the best price for your trade." />
                                    </span>
                                    {bestTrade && <SwapRoute trade={bestTrade} />}
                                </RowBetween>
                            )}
                        </PoolBreakDownWrapper>
                        <>
                            {!account ? (
                                <ButtonLight style={{ marginTop: '20px' }} onClick={toggleWalletModal}>
                                    Connect Wallet
                                </ButtonLight>
                            ) : noRoute && bestTrade?.inputAmount ? (
                                <ButtonError style={{ marginTop: '20px' }}>
                                    <TYPE.main mb="4px">Insufficient liquidity for this trade.</TYPE.main>
                                </ButtonError>
                            ) : showApproveFlow ? (
                                <RowBetween>
                                    <ButtonPrimary
                                        onClick={approveCallback}
                                        disabled={approval !== ApprovalState.NOT_APPROVED || approvalSubmitted}
                                        style={{ width: '48%', marginTop: '20px' }}
                                    >
                                        {approval === ApprovalState.PENDING ? (
                                            <AutoRow gap="6px" justify="center">
                                                Approving <Loader stroke="white" />
                                            </AutoRow>
                                        ) : approvalSubmitted && approval === ApprovalState.APPROVED ? (
                                            'Approved'
                                        ) : (
                                            'Approve ' + currency?.getSymbol(chainId)
                                        )}
                                    </ButtonPrimary>
                                    <ButtonPrimary
                                        onClick={() => zapCallback()}
                                        style={{ width: '48%', marginTop: '20px' }}
                                        id="swap-button"
                                        disabled={approval !== ApprovalState.APPROVED}
                                    >
                                        <Text fontSize={20} fontWeight={500}>
                                            {error ?? 'Zap'}
                                        </Text>
                                    </ButtonPrimary>
                                </RowBetween>
                            ) : priceImpactSeverity > 1 && error === undefined ? (
                                <ButtonError
                                    disabled={priceImpactSeverity > 3}
                                    error={priceImpactSeverity > 1}
                                    style={{ marginTop: '20px' }}
                                    onClick={() => zapCallback()}
                                >
                                    <Text fontSize={16} fontWeight={500}>
                                        {priceImpactSeverity > 3
                                            ? `Price Impact Too High`
                                            : `Swap${priceImpactSeverity > 2 ? ' Anyway' : ''}`}
                                    </Text>
                                </ButtonError>
                            ) : (
                                <ButtonPrimary
                                    style={{ marginTop: '20px' }}
                                    disabled={
                                        !parsedAmount || error !== undefined || approval !== ApprovalState.APPROVED
                                    }
                                    onClick={() => zapCallback()}
                                >
                                    <Text fontSize={20} fontWeight={500}>
                                        {error ?? 'Zap'}
                                    </Text>
                                </ButtonPrimary>
                            )}
                            {showApproveFlow && (
                                <Column style={{ marginTop: '1rem' }}>
                                    <ProgressSteps steps={[approval === ApprovalState.APPROVED]} />
                                </Column>
                            )}
                        </>
                    </AutoColumn>
                </div>
            )}
        </>
    )
}

export default AddSingleSideLiquidity
