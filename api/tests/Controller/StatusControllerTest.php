<?php

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class StatusControllerTest extends WebTestCase
{
    public function testValidTzReturns200WithExpectedShape(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=Europe/Berlin');

        $this->assertResponseIsSuccessful();
        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertSame('Europe/Berlin', $body['tz']);
        $this->assertArrayHasKey('utcTime', $body);
        $this->assertArrayHasKey('localTime', $body);
        $this->assertArrayHasKey('peak', $body);
        $this->assertContains($body['reason'], ['window', 'weekend', 'holiday']);
        $this->assertArrayHasKey('at', $body['nextTransition']);
        $this->assertArrayHasKey('peak', $body['nextTransition']);
    }

    public function testMissingTzDefaultsToUtc(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status');

        $this->assertResponseIsSuccessful();
        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertSame('UTC', $body['tz']);
    }

    public function testInvalidTzReturns400(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=Not/AZone');

        $this->assertSame(400, $client->getResponse()->getStatusCode());
        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertStringContainsString('Not/AZone', $body['error']);
    }

    public function testEmptyTzReturns400(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=');

        $this->assertSame(400, $client->getResponse()->getStatusCode());
    }

    public function testLowercaseTzReturns400(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=europe/berlin');

        $this->assertSame(400, $client->getResponse()->getStatusCode());
    }

    public function testHeadersArePresent(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=UTC');

        $response = $client->getResponse();
        $this->assertSame('*', $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertMatchesRegularExpression('/^public, max-age=\d+$/', $response->headers->get('Cache-Control'));
    }

    public function testInvalidTzResponseIsNotCached(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=Not/AZone');

        $this->assertSame('no-store', $client->getResponse()->headers->get('Cache-Control'));
    }
}
