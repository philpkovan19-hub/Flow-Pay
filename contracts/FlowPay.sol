// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title FlowPay - Streaming payments (money per second) for BOT Chain
/// @notice Send BOT continuously over a duration; recipient can withdraw as it streams.
contract FlowPay is Ownable, ReentrancyGuard, Pausable {
    struct Stream {
        address sender;
        address recipient;
        uint256 totalAmount;   // amount after fee, streamed to recipient
        uint256 ratePerSec;    // wei per second (totalAmount / duration)
        uint256 startTime;
        uint256 duration;
        uint256 withdrawn;
        bool active;
    }

    uint256 public streamCount;
    uint256 public platformFeeBps = 50; // 0.5%
    uint256 public accumulatedFees;
    uint256 public constant MAX_FEE_BPS = 1000; // 10% hard cap

    mapping(uint256 => Stream) private streams;
    mapping(address => uint256[]) private senderStreams;
    mapping(address => uint256[]) private recipientStreams;

    event StreamOpened(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 totalAmount,
        uint256 ratePerSec,
        uint256 duration,
        uint256 startTime
    );
    event Withdrawn(uint256 indexed streamId, address indexed recipient, uint256 amount);
    event StreamCancelled(
        uint256 indexed streamId,
        address indexed sender,
        uint256 refundedToSender,
        uint256 paidToRecipient
    );
    event PlatformFeeChanged(uint256 oldBps, uint256 newBps);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /// @notice Open a new stream, transferring msg.value from sender.
    function openStream(address recipient, uint256 durationSecs)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 streamId)
    {
        require(recipient != address(0), "recipient=0");
        require(recipient != msg.sender, "self stream");
        require(durationSecs > 0, "duration=0");
        require(msg.value > 0, "amount=0");

        uint256 fee = (msg.value * platformFeeBps) / 10_000;
        uint256 streamAmount = msg.value - fee;
        require(streamAmount >= durationSecs, "amount too small for duration");

        uint256 ratePerSec = streamAmount / durationSecs;
        // ensure totalAmount is exactly ratePerSec * durationSecs (any dust goes to fees)
        uint256 exactTotal = ratePerSec * durationSecs;
        uint256 dust = streamAmount - exactTotal;
        accumulatedFees += fee + dust;

        streamId = streamCount++;
        streams[streamId] = Stream({
            sender: msg.sender,
            recipient: recipient,
            totalAmount: exactTotal,
            ratePerSec: ratePerSec,
            startTime: block.timestamp,
            duration: durationSecs,
            withdrawn: 0,
            active: true
        });

        senderStreams[msg.sender].push(streamId);
        recipientStreams[recipient].push(streamId);

        emit StreamOpened(streamId, msg.sender, recipient, exactTotal, ratePerSec, durationSecs, block.timestamp);
    }

    /// @notice Amount recipient can currently withdraw.
    function withdrawableAmount(uint256 streamId) public view returns (uint256) {
        Stream memory s = streams[streamId];
        if (s.startTime == 0) return 0;
        uint256 elapsed = block.timestamp - s.startTime;
        uint256 streamed = elapsed * s.ratePerSec;
        if (streamed > s.totalAmount) streamed = s.totalAmount;
        if (streamed <= s.withdrawn) return 0;
        return streamed - s.withdrawn;
    }

    /// @notice Recipient withdraws streamed funds.
    function withdraw(uint256 streamId) external nonReentrant whenNotPaused {
        Stream storage s = streams[streamId];
        require(s.active, "inactive");
        require(msg.sender == s.recipient, "not recipient");

        uint256 amount = withdrawableAmount(streamId);
        require(amount > 0, "nothing to withdraw");
        s.withdrawn += amount;

        // if fully streamed & fully withdrawn, close
        if (s.withdrawn >= s.totalAmount) {
            s.active = false;
        }

        (bool ok, ) = s.recipient.call{value: amount}("");
        require(ok, "transfer failed");

        emit Withdrawn(streamId, s.recipient, amount);
    }

    /// @notice Sender cancels stream: recipient gets any pending, sender gets remainder.
    function cancel(uint256 streamId) external nonReentrant {
        Stream storage s = streams[streamId];
        require(s.active, "inactive");
        require(msg.sender == s.sender, "not sender");

        uint256 pending = withdrawableAmount(streamId);
        uint256 alreadyPaid = s.withdrawn + pending;
        uint256 refund = s.totalAmount > alreadyPaid ? s.totalAmount - alreadyPaid : 0;

        s.withdrawn = s.withdrawn + pending;
        s.active = false;

        if (pending > 0) {
            (bool ok1, ) = s.recipient.call{value: pending}("");
            require(ok1, "recipient xfer failed");
        }
        if (refund > 0) {
            (bool ok2, ) = s.sender.call{value: refund}("");
            require(ok2, "sender xfer failed");
        }

        emit StreamCancelled(streamId, s.sender, refund, pending);
    }

    function getStream(uint256 streamId)
        external
        view
        returns (
            address sender,
            address recipient,
            uint256 totalAmount,
            uint256 ratePerSec,
            uint256 startTime,
            uint256 duration,
            uint256 withdrawn,
            bool active
        )
    {
        Stream memory s = streams[streamId];
        return (s.sender, s.recipient, s.totalAmount, s.ratePerSec, s.startTime, s.duration, s.withdrawn, s.active);
    }

    function getStreamsBySender(address who) external view returns (uint256[] memory) {
        return senderStreams[who];
    }

    function getStreamsByRecipient(address who) external view returns (uint256[] memory) {
        return recipientStreams[who];
    }

    // ---- Admin ----

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setPlatformFeeBps(uint256 newBps) external onlyOwner {
        require(newBps <= MAX_FEE_BPS, "fee too high");
        emit PlatformFeeChanged(platformFeeBps, newBps);
        platformFeeBps = newBps;
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 amt = accumulatedFees;
        require(amt > 0, "no fees");
        accumulatedFees = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "xfer failed");
        emit FeesWithdrawn(to, amt);
    }

    receive() external payable {
        accumulatedFees += msg.value;
    }
}
