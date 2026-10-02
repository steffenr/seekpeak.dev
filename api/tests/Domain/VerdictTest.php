<?php

namespace App\Tests\Domain;

use App\Domain\Config;
use App\Domain\Verdict;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class VerdictTest extends TestCase
{
    private Verdict $verdict;

    protected function setUp(): void
    {
        $this->verdict = new Verdict(new Config());
    }

    /**
     * @return iterable<string, array{string, bool, string}>
     */
    public static function sharedFixtureCases(): iterable
    {
        $path = __DIR__ . '/../../../tests/fixtures/verdict-cases.json';
        $cases = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        foreach ($cases as $case) {
            yield $case['instant'] => [$case['instant'], $case['peak'], $case['reason']];
        }
    }

    #[DataProvider('sharedFixtureCases')]
    public function testIsPeakAndReasonMatchSharedFixtures(string $instant, bool $expectedPeak, string $expectedReason): void
    {
        $d = new \DateTimeImmutable($instant);
        $this->assertSame($expectedPeak, $this->verdict->isPeak($d), "isPeak mismatch for {$instant}");
        $this->assertSame($expectedReason, $this->verdict->reason($d), "reason mismatch for {$instant}");
    }

    public function testNextTransitionPlainWeekday(): void
    {
        $now = new \DateTimeImmutable('2026-01-06T05:00:00.000Z');
        $t = $this->verdict->nextTransition($now);
        $this->assertSame('2026-01-06T06:00:00.000Z', $t->format('Y-m-d\TH:i:s.v\Z'));
        $this->assertTrue($this->verdict->isPeak($t));
    }

    public function testNextTransitionSpansCombinedWeekendAndHoliday(): void
    {
        $now = new \DateTimeImmutable('2026-02-15T07:00:00.000Z');
        $t = $this->verdict->nextTransition($now);
        $this->assertSame('2026-02-24T01:00:00.000Z', $t->format('Y-m-d\TH:i:s.v\Z'));
        $this->assertTrue($this->verdict->isPeak($t));
    }

    public function testNextTransitionWorstCaseLookahead(): void
    {
        // "Now" on the UTC calendar day before the run starts — the scenario
        // that overflowed the old 10-day lookahead (see ADR-005).
        $now = new \DateTimeImmutable('2026-02-13T23:00:00.000Z');
        $t = $this->verdict->nextTransition($now);
        $this->assertSame('2026-02-24T01:00:00.000Z', $t->format('Y-m-d\TH:i:s.v\Z'));
    }

    public function testEvaluateCombinesPeakReasonAndNextTransition(): void
    {
        $now = new \DateTimeImmutable('2026-02-18T07:00:00.000Z');
        $result = $this->verdict->evaluate($now);
        $this->assertFalse($result->peak);
        $this->assertSame('holiday', $result->reason);
        $this->assertTrue($result->nextTransitionPeak);
    }
}
