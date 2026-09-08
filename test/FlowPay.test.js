const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FlowPay", function () {
  let flowpay, owner, alice, bob, carol;
  const HOUR = 3600;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const F = await ethers.getContractFactory("FlowPay");
    flowpay = await F.deploy();
    await flowpay.waitForDeployment();
  });

  describe("openStream", function () {
    it("creates a stream and deducts platform fee", async function () {
      const amount = ethers.parseEther("10");
      const tx = await flowpay.connect(alice).openStream(bob.address, HOUR, { value: amount });
      await tx.wait();

      expect(await flowpay.streamCount()).to.equal(1n);
      const s = await flowpay.getStream(0);
      expect(s.sender).to.equal(alice.address);
      expect(s.recipient).to.equal(bob.address);
      // fee = 0.5% = 0.05 ETH; streamAmount = 9.95 ETH; rounded to multiple of duration
      const fee = amount * 50n / 10000n;
      const streamAmt = amount - fee;
      const rate = streamAmt / BigInt(HOUR);
      const exactTotal = rate * BigInt(HOUR);
      expect(s.totalAmount).to.equal(exactTotal);
      expect(s.ratePerSec).to.equal(rate);
      expect(s.active).to.equal(true);
    });

    it("reverts on zero recipient / self / zero duration / zero value", async function () {
      await expect(
        flowpay.connect(alice).openStream(ethers.ZeroAddress, HOUR, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("recipient=0");
      await expect(
        flowpay.connect(alice).openStream(alice.address, HOUR, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("self stream");
      await expect(
        flowpay.connect(alice).openStream(bob.address, 0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("duration=0");
      await expect(
        flowpay.connect(alice).openStream(bob.address, HOUR, { value: 0 })
      ).to.be.revertedWith("amount=0");
    });

    it("indexes streams by sender and recipient", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("2") });
      await flowpay.connect(alice).openStream(carol.address, HOUR, { value: ethers.parseEther("2") });
      const a = await flowpay.getStreamsBySender(alice.address);
      const b = await flowpay.getStreamsByRecipient(bob.address);
      const c = await flowpay.getStreamsByRecipient(carol.address);
      expect(a.length).to.equal(2);
      expect(b.length).to.equal(1);
      expect(c.length).to.equal(1);
    });
  });

  describe("withdrawableAmount", function () {
    it("increases linearly with time and caps at total", async function () {
      const amount = ethers.parseEther("10");
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: amount });
      expect(await flowpay.withdrawableAmount(0)).to.equal(0n);

      await time.increase(HOUR / 4);
      const s = await flowpay.getStream(0);
      const w1 = await flowpay.withdrawableAmount(0);
      // roughly quarter
      expect(w1).to.be.greaterThan((s.totalAmount * 24n) / 100n);
      expect(w1).to.be.lessThan((s.totalAmount * 26n) / 100n);

      await time.increase(HOUR * 2);
      expect(await flowpay.withdrawableAmount(0)).to.equal(s.totalAmount);
    });
  });

  describe("withdraw", function () {
    it("only recipient can withdraw", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") });
      await time.increase(HOUR / 2);
      await expect(flowpay.connect(alice).withdraw(0)).to.be.revertedWith("not recipient");
      await expect(flowpay.connect(carol).withdraw(0)).to.be.revertedWith("not recipient");
    });

    it("pays the recipient the withdrawable amount", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("10") });
      await time.increase(HOUR / 2);
      const before = await ethers.provider.getBalance(bob.address);
      const tx = await flowpay.connect(bob).withdraw(0);
      const rc = await tx.wait();
      const gas = rc.gasUsed * rc.gasPrice;
      const after = await ethers.provider.getBalance(bob.address);
      expect(after + gas - before).to.be.greaterThan(ethers.parseEther("4.9"));
    });

    it("closes stream when fully streamed and withdrawn", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") });
      await time.increase(HOUR * 2);
      await flowpay.connect(bob).withdraw(0);
      const s = await flowpay.getStream(0);
      expect(s.active).to.equal(false);
    });

    it("reverts when nothing to withdraw", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") });
      await expect(flowpay.connect(bob).withdraw(0)).to.be.revertedWith("nothing to withdraw");
    });
  });

  describe("cancel", function () {
    it("only sender can cancel", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") });
      await expect(flowpay.connect(bob).cancel(0)).to.be.revertedWith("not sender");
    });

    it("refunds sender and pays recipient the accrued amount", async function () {
      const amount = ethers.parseEther("10");
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: amount });
      await time.increase(HOUR / 2);

      const bobBefore = await ethers.provider.getBalance(bob.address);
      const aliceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await flowpay.connect(alice).cancel(0);
      const rc = await tx.wait();
      const gas = rc.gasUsed * rc.gasPrice;
      const bobAfter = await ethers.provider.getBalance(bob.address);
      const aliceAfter = await ethers.provider.getBalance(alice.address);

      const bobDelta = bobAfter - bobBefore;
      const aliceDelta = aliceAfter + gas - aliceBefore;
      expect(bobDelta).to.be.greaterThan(ethers.parseEther("4.9"));
      expect(aliceDelta).to.be.greaterThan(ethers.parseEther("4.9"));

      const s = await flowpay.getStream(0);
      expect(s.active).to.equal(false);
    });
  });

  describe("pause", function () {
    it("blocks openStream when paused, allows when unpaused", async function () {
      await flowpay.connect(owner).pause();
      await expect(
        flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(flowpay, "EnforcedPause");
      await flowpay.connect(owner).unpause();
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("1") });
    });

    it("only owner can pause", async function () {
      await expect(flowpay.connect(alice).pause()).to.be.revertedWithCustomError(flowpay, "OwnableUnauthorizedAccount");
    });
  });

  describe("admin fee", function () {
    it("owner can change fee up to cap", async function () {
      await flowpay.connect(owner).setPlatformFeeBps(200);
      expect(await flowpay.platformFeeBps()).to.equal(200n);
      await expect(flowpay.connect(owner).setPlatformFeeBps(1001)).to.be.revertedWith("fee too high");
    });

    it("owner can withdraw accumulated fees", async function () {
      await flowpay.connect(alice).openStream(bob.address, HOUR, { value: ethers.parseEther("10") });
      const before = await ethers.provider.getBalance(carol.address);
      await flowpay.connect(owner).withdrawFees(carol.address);
      const after = await ethers.provider.getBalance(carol.address);
      expect(after - before).to.be.greaterThan(0n);
    });

    it("non-owner cannot withdraw fees", async function () {
      await expect(flowpay.connect(alice).withdrawFees(alice.address)).to.be.revertedWithCustomError(flowpay, "OwnableUnauthorizedAccount");
    });
  });
});
