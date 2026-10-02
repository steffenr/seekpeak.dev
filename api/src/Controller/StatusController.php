<?php

namespace App\Controller;

use App\Domain\Config;
use App\Domain\Verdict;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class StatusController
{
    #[Route('/v1/status', name: 'status', methods: ['GET'])]
    public function __invoke(Request $request): JsonResponse
    {
        $tz = $request->query->get('tz', 'UTC');

        if (!in_array($tz, \DateTimeZone::listIdentifiers(\DateTimeZone::ALL_WITH_BC), true)) {
            return new JsonResponse(
                ['error' => "unknown timezone: {$tz}"],
                400,
                [
                    'Access-Control-Allow-Origin' => '*',
                    'Cache-Control' => 'no-store',
                ]
            );
        }

        $config = new Config();
        $verdict = new Verdict($config);
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $result = $verdict->evaluate($now);

        $localTime = $now->setTimezone(new \DateTimeZone($tz));
        $maxAge = self::cacheMaxAgeSeconds($now, $result->nextTransitionAt);

        return new JsonResponse(
            [
                'tz' => $tz,
                'utcTime' => $now->format('Y-m-d\TH:i:s.v\Z'),
                'localTime' => $localTime->format('Y-m-d\TH:i:sP'),
                'peak' => $result->peak,
                'reason' => $result->reason,
                'nextTransition' => [
                    'at' => $result->nextTransitionAt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'),
                    'peak' => $result->nextTransitionPeak,
                ],
                'models' => $config->models(),
            ],
            200,
            [
                'Access-Control-Allow-Origin' => '*',
                'Cache-Control' => "public, max-age={$maxAge}",
            ]
        );
    }

    public static function cacheMaxAgeSeconds(\DateTimeImmutable $now, \DateTimeImmutable $nextTransitionAt): int
    {
        return min(300, max(0, $nextTransitionAt->getTimestamp() - $now->getTimestamp()));
    }
}
