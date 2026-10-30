// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

// Test fixture only. This is not a LayerZero security implementation.
struct Origin { uint32 srcEid; bytes32 sender; uint64 nonce; }
struct Fee { uint256 nativeFee; uint256 lzTokenFee; }
struct Params { uint32 dstEid; bytes32 receiver; bytes message; bytes options; bool payInLzToken; }
struct Receipt { bytes32 guid; uint64 nonce; Fee fee; }
interface TokenReceiver {
    function lzReceive(Origin calldata, bytes32, bytes calldata, address, bytes calldata) external payable;
}
contract ReviewEndpoint {
    address public immutable controller = msg.sender;
    mapping(address => address) public delegates;
    mapping(address => uint32) public eids;
    mapping(address => uint256) public configMarker;
    bool public transportFails;
    uint64 public sequence;
    struct Packet { address sender; uint32 src; uint32 dst; bytes32 receiver; bytes message; uint64 nonce; bool delivered; }
    mapping(bytes32 => Packet) public packets;
    modifier onlyController() { require(msg.sender == controller, "test controller only"); _; }
    function setDelegate(address who) external { delegates[msg.sender] = who; }
    function setEid(address token, uint32 eid) external onlyController { eids[token] = eid; }
    function setTransportFails(bool value) external onlyController { transportFails = value; }
    function setConfigMarker(address token, uint256 value) external {
        require(msg.sender == token || msg.sender == delegates[token], "not delegate"); configMarker[token] = value;
    }
    function quote(Params calldata, address) external pure returns (Fee memory) { return Fee(0, 0); }
    function send(Params calldata p, address) external payable returns (Receipt memory) {
        require(!transportFails, "transport unavailable");
        uint64 n = ++sequence;
        bytes32 guid = keccak256(abi.encode(msg.sender, n));
        packets[guid] = Packet(msg.sender, eids[msg.sender], p.dstEid, p.receiver, p.message, n, false);
        return Receipt(guid, n, Fee(0, 0));
    }
    function deliver(bytes32 guid) external onlyController {
        Packet storage p = packets[guid];
        require(p.sender != address(0) && !p.delivered, "missing or delivered packet");
        require(eids[address(uint160(uint256(p.receiver)))] == p.dst, "wrong destination");
        p.delivered = true;
        TokenReceiver(address(uint160(uint256(p.receiver)))).lzReceive(
            Origin(p.src, bytes32(uint256(uint160(p.sender))), p.nonce), guid, p.message, address(this), hex""
        );
    }
    // Deliberately bypasses source burn to show the residual trusted-peer/Endpoint assumption.
    function inject(address token, uint32 eid, bytes32 peer, address to, uint64 amount) external onlyController {
        TokenReceiver(token).lzReceive(Origin(eid, peer, ++sequence), bytes32(uint256(sequence)),
            abi.encodePacked(bytes32(uint256(uint160(to))), amount), address(this), hex"");
    }
    function sendCompose(address, bytes32, uint16, bytes calldata) external {}
}
