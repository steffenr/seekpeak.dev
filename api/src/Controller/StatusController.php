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

        if (!in_array($tz, \DateTimeZone::listIdentifiers(), true)) {
            $response = new JsonResponse(
                ['error' => "unknown timezone: {$tz}"],
                400,
                ['Access-Control-Allow-Origin' => '*']
            );

            return self::withExactCacheControl($response, 'no-store');
        }

        $config = new Config();
        $verdict = new Verdict($config);
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $result = $verdict->evaluate($now);

        $localTime = $now->setTimezone(new \DateTimeZone($tz));
        $maxAge = min(300, max(0, $result->nextTransitionAt->getTimestamp() - $now->getTimestamp()));

        $response = new JsonResponse(
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
            ],
            200,
            ['Access-Control-Allow-Origin' => '*']
        );

        return self::withExactCacheControl($response, "public, max-age={$maxAge}");
    }

    /**
     * Symfony's ResponseHeaderBag normalizes any Cache-Control value passed through
     * its normal set() path: it ksort()s directives (breaking a fixed "public, max-age=N"
     * order) and appends ", private" to any directive set that doesn't already include
     * "public"/"private" (breaking a bare "no-store"). Both behaviors are internal to
     * ResponseHeaderBag::computeCacheControlValue() and have no public bypass, so the
     * literal header value is written directly to avoid them.
     */
    private static function withExactCacheControl(JsonResponse $response, string $value): JsonResponse
    {
        $headers = new \ReflectionProperty($response->headers, 'headers');
        $raw = $headers->getValue($response->headers);
        $raw['cache-control'] = [$value];
        $headers->setValue($response->headers, $raw);

        return $response;
    }
}
