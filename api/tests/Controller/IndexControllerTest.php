<?php

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class IndexControllerTest extends WebTestCase
{
    public function testRootReturnsApiDescription(): void
    {
        $client = static::createClient();
        $client->request('GET', '/');

        $this->assertResponseIsSuccessful();
        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertSame('Seek Peak Status API', $body['name']);
        $this->assertSame('v1', $body['version']);
        $this->assertArrayHasKey('status', $body['endpoints']);
        $this->assertSame('/v1/status?tz={IANA timezone, e.g. Europe/Berlin}', $body['endpoints']['status']);
        $this->assertSame('https://seekpeak.dev', $body['site']);
    }

    public function testRootResponseIsCacheableAndCorsOpen(): void
    {
        $client = static::createClient();
        $client->request('GET', '/');

        $response = $client->getResponse();
        $this->assertSame('*', $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertStringContainsString('public', $response->headers->get('Cache-Control'));
        $this->assertMatchesRegularExpression('/\bmax-age=\d+\b/', $response->headers->get('Cache-Control'));
    }
}
