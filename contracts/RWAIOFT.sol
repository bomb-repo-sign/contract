// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import { IOFT } from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import { IERC5267 } from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title  RWAI
/// @notice LayerZero V2 OFT with no transfer controls or direct administrator mint.
/// @dev    no blacklist, pause or inspector. peers are write once; delegate syncs on ownership acceptance.
contract RWAIOFT is OFT, Ownable2Step, ERC20Permit, ERC20Burnable, IERC165 {
    uint256 public constant INITIAL_SUPPLY = 1e9 * 1e18;
    uint256 public constant HOME_CHAIN_ID = 56;
    uint256 public constant HOME_TESTNET_CHAIN_ID = 97;

    event Finalized();

    error ZeroPeer();
    error PeerLocked(uint32 eid);
    error InspectorDisabled();
    error TransferToToken();
    error LengthMismatch();
    error AmountTooLarge(uint256 amountLD);

    constructor(
        address lzEndpoint,
        address admin
    ) OFT("RWAI", "RWAI", lzEndpoint, admin) Ownable(admin) ERC20Permit("RWAI") {
        if (isHomeChain()) _mint(admin, INITIAL_SUPPLY);
    }

    // holder pays out to many in one tx, only ever moves msg.sender's own balance
    function transferBatch(address[] calldata to, uint256[] calldata amounts) external returns (bool) {
        if (to.length != amounts.length) revert LengthMismatch();
        address from = _msgSender();
        for (uint256 i = 0; i < to.length; ++i) {
            _transfer(from, to[i], amounts[i]);
        }
        return true;
    }

    function isHomeChain() public view returns (bool) {
        return block.chainid == HOME_CHAIN_ID || block.chainid == HOME_TESTNET_CHAIN_ID;
    }

    function isFinalized() external view returns (bool) {
        return owner() == address(0);
    }

    function routeLocked(uint32 eid) external view returns (bool) {
        return peers[eid] != bytes32(0);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return
            id == type(IERC165).interfaceId ||
            id == type(IERC20).interfaceId ||
            id == type(IERC20Metadata).interfaceId ||
            id == type(IERC20Permit).interfaceId ||
            id == type(IERC5267).interfaceId ||
            id == type(IOFT).interfaceId;
    }

    function _setPeer(uint32 eid, bytes32 peer) internal override {
        if (peer == bytes32(0)) revert ZeroPeer();
        if (peers[eid] != bytes32(0)) revert PeerLocked(eid);
        super._setPeer(eid, peer);
    }

    // upstream casts to uint64 without a check, an oversized send would burn all of it and credit a fraction
    function _toSD(uint256 amountLD) internal view override returns (uint64) {
        uint256 sd = amountLD / decimalConversionRate;
        if (sd > type(uint64).max) revert AmountTooLarge(amountLD);
        return uint64(sd);
    }

    // same bound for every quote and before the burn, so quoteOFT agrees with send
    function _debitView(
        uint256 amountLD,
        uint256 minAmountLD,
        uint32 dstEid
    ) internal view override returns (uint256 sent, uint256 received) {
        (sent, received) = super._debitView(amountLD, minAmountLD, dstEid);
        if (sent / decimalConversionRate > type(uint64).max) revert AmountTooLarge(sent);
    }

    function setMsgInspector(address) public pure override {
        revert InspectorDisabled();
    }

    // direct transfers into the token itself would be stuck forever, refuse them. mints and burns untouched
    function _update(address from, address to, uint256 value) internal override {
        if (to == address(this) && from != address(0)) revert TransferToToken();
        super._update(from, to, value);
    }

    // delegate rides along with ownership, no stale key left on the endpoint
    function acceptOwnership() public override {
        super.acceptOwnership();
        endpoint.setDelegate(msg.sender);
    }

    // renounce freezes local configuration; existing bridge receive mint remains enabled
    function renounceOwnership() public override onlyOwner {
        endpoint.setDelegate(address(0));
        super.renounceOwnership();
        emit Finalized();
    }

    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) {
        super.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) {
        super._transferOwnership(newOwner);
    }
}
