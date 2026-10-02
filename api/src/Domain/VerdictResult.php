<?php

namespace App\Domain;

final class VerdictResult
{
    public function __construct(
        public readonly bool $peak,
        public readonly string $reason,
        public readonly \DateTimeImmutable $nextTransitionAt,
        public readonly bool $nextTransitionPeak,
    ) {
    }
}
