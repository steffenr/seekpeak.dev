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

    public function testResponseIncludesModelPriceTable(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status');

        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertNotEmpty($body['models']);
        $model = $body['models'][0];
        $this->assertArrayHasKey('id', $model);
        $this->assertArrayHasKey('offPeak', $model['cacheHit']);
        $this->assertArrayHasKey('peak', $model['cacheHit']);
        $this->assertArrayHasKey('offPeak', $model['cacheMiss']);
        $this->assertArrayHasKey('peak', $model['cacheMiss']);
        $this->assertArrayHasKey('offPeak', $model['output']);
        $this->assertArrayHasKey('peak', $model['output']);
    }

    public function testIanaBackwardCompatibleAliasIsAccepted(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=Asia/Calcutta');

        $this->assertSame(200, $client->getResponse()->getStatusCode());
        $body = json_decode($client->getResponse()->getContent(), true);
        $this->assertSame('Asia/Calcutta', $body['tz']);
    }

    public function testFrameworkErrorResponsesCarryCorsAndNoStore(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/nonexistent');

        $response = $client->getResponse();
        $this->assertSame(404, $response->getStatusCode());
        $this->assertSame('*', $response->headers->get('Access-Control-Allow-Origin'));
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
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
        $cacheControl = $response->headers->get('Cache-Control');
        $this->assertStringContainsString('public', $cacheControl);
        $this->assertMatchesRegularExpression('/\bmax-age=\d+\b/', $cacheControl);
    }

    public function testInvalidTzResponseIsNotCached(): void
    {
        $client = static::createClient();
        $client->request('GET', '/v1/status?tz=Not/AZone');

        $this->assertStringContainsString('no-store', $client->getResponse()->headers->get('Cache-Control'));
    }
}
