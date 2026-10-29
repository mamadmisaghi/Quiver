// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
/// @notice TEST-ONLY Chainlink AggregatorV3-shaped feed for local anvil tests.
contract MockAggregator {
    uint8 public constant decimals = 8; string public description; uint256 public constant version = 6;
    uint80 public latestRound; mapping(uint80 => int256) public answers; mapping(uint80 => uint256) public times;
    constructor(string memory d) { description = d; }
    function push(int256 a, uint256 t) external { latestRound++; answers[latestRound] = a; times[latestRound] = t; }
    function getRoundData(uint80 r) public view returns (uint80, int256, uint256, uint256, uint80) { require(times[r] != 0, "No data present"); return (r, answers[r], times[r], times[r], r); }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return getRoundData(latestRound); }
}
