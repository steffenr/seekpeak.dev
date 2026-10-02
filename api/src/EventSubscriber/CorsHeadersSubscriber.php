<?php

namespace App\EventSubscriber;

use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

final class CorsHeadersSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::RESPONSE => 'onKernelResponse'];
    }

    public function onKernelResponse(ResponseEvent $event): void
    {
        $response = $event->getResponse();
        $headers = $response->headers;

        if (!$headers->has('Access-Control-Allow-Origin')) {
            $headers->set('Access-Control-Allow-Origin', '*');
        }

        if ($response->getStatusCode() < 400) {
            return;
        }

        // ResponseHeaderBag always computes a default Cache-Control ("no-cache, private"),
        // so "already set" means any explicit caching directive is present.
        foreach (['no-store', 'public', 'max-age', 's-maxage'] as $directive) {
            if ($headers->hasCacheControlDirective($directive)) {
                return;
            }
        }
        $headers->set('Cache-Control', 'no-store');
    }
}
