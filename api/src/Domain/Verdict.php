<?php

namespace App\Domain;

final class Verdict
{
    public function __construct(private Config $config)
    {
    }

    public function isPeak(\DateTimeImmutable $utcInstant): bool
    {
        if ($this->isWeekend($utcInstant) || $this->isChineseHoliday($utcInstant)) {
            return false;
        }
        $utc = $utcInstant->setTimezone(new \DateTimeZone('UTC'));
        $sec = ((int) $utc->format('H')) * 3600
            + ((int) $utc->format('i')) * 60
            + (int) $utc->format('s')
            + ((int) $utc->format('v')) / 1000;
        foreach ($this->config->peakWindows() as [$start, $end]) {
            $startSec = $this->toMin($start) * 60;
            $endSec = $this->toMin($end) * 60;
            if ($sec >= $startSec && $sec < $endSec) {
                return true;
            }
        }
        return false;
    }

    public function isWeekend(\DateTimeImmutable $utcInstant): bool
    {
        $cfg = $this->config->weekendOffPeak();
        $day = (int) $utcInstant->setTimezone(new \DateTimeZone($cfg['timezone']))->format('w');
        return in_array($day, $cfg['days'], true);
    }

    public function isChineseHoliday(\DateTimeImmutable $utcInstant): bool
    {
        $cfg = $this->config->chinaPublicHolidays();
        $key = $utcInstant->setTimezone(new \DateTimeZone($cfg['timezone']))->format('Y-m-d');
        return in_array($key, $cfg['dates'], true);
    }

    public function reason(\DateTimeImmutable $utcInstant): string
    {
        if ($this->isWeekend($utcInstant)) {
            return 'weekend';
        }
        if ($this->isChineseHoliday($utcInstant)) {
            return 'holiday';
        }
        return 'window';
    }

    public function nextTransition(\DateTimeImmutable $now): \DateTimeImmutable
    {
        $v0 = $this->isPeak($now);
        $dayStart = $now->setTimezone(new \DateTimeZone('UTC'))->setTime(0, 0, 0);

        $boundaryMinutes = [];
        foreach ($this->config->peakWindows() as [$start, $end]) {
            $boundaryMinutes[] = $this->toMin($start);
            $boundaryMinutes[] = $this->toMin($end);
        }

        $candidates = [];
        for ($day = 0; $day <= 20; $day++) {
            $dayInstant = $dayStart->modify("+{$day} days");
            foreach ($boundaryMinutes as $min) {
                $candidates[] = $dayInstant->modify("+{$min} minutes");
            }
        }
        usort($candidates, static fn (\DateTimeImmutable $a, \DateTimeImmutable $b) => $a <=> $b);

        foreach ($candidates as $t) {
            if ($t > $now && $this->isPeak($t) !== $v0) {
                return $t;
            }
        }
        throw new \RuntimeException('no transition found within the 20-day lookahead window');
    }

    public function evaluate(\DateTimeImmutable $now): VerdictResult
    {
        $next = $this->nextTransition($now);
        return new VerdictResult(
            peak: $this->isPeak($now),
            reason: $this->reason($now),
            nextTransitionAt: $next,
            nextTransitionPeak: $this->isPeak($next),
        );
    }

    private function toMin(string $hhmm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hhmm));
        return $h * 60 + $m;
    }
}
