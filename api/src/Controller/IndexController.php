<?php

namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

final class IndexController
{
    #[Route('/', name: 'index', methods: ['GET'])]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse(
            [
                'name' => 'Seek Peak Status API',
                'version' => 'v1',
                'endpoints' => [
                    'status' => '/v1/status?tz={IANA timezone, e.g. Europe/Berlin}',
                ],
                'site' => 'https://seekpeak.dev',
            ],
            200,
            [
                'Access-Control-Allow-Origin' => '*',
                'Cache-Control' => 'public, max-age=3600',
            ]
        );
    }
}
