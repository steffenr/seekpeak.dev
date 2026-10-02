<?php

namespace App\Tests\Controller;

use App\Controller\StatusController;
use PHPUnit\Framework\TestCase;

final class StatusControllerCacheTest extends TestCase
{
    public function testMaxAgeIsCappedAt300Seconds(): void
    {
        $now = new \DateTimeImmutable('2026-02-14T00:00:00.000Z');
        $next = $now->modify('+10 days');

        $this->assertSame(300, StatusController::cacheMaxAgeSeconds($now, $next));
    }

    public function testMaxAgeIsTheGapWhenTransitionIsNear(): void
    {
        $now = new \DateTimeImmutable('2026-01-08T09:58:00.000Z');
        $next = new \DateTimeImmutable('2026-01-08T10:00:00.000Z');

        $this->assertSame(120, StatusController::cacheMaxAgeSeconds($now, $next));
    }

    public function testMaxAgeNeverNegative(): void
    {
        $now = new \DateTimeImmutable('2026-01-08T10:00:01.000Z');
        $next = new \DateTimeImmutable('2026-01-08T10:00:00.000Z');

        $this->assertSame(0, StatusController::cacheMaxAgeSeconds($now, $next));
    }
}
