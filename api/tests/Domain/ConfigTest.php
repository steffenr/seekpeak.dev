<?php

namespace App\Tests\Domain;

use App\Domain\Config;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    private string $fixturePath;

    protected function setUp(): void
    {
        $this->fixturePath = tempnam(sys_get_temp_dir(), 'config-test-');
        file_put_contents($this->fixturePath, json_encode([
            'peakWindows' => [['01:00', '04:00'], ['06:00', '10:00']],
            'weekendOffPeak' => ['timezone' => 'Asia/Shanghai', 'days' => [0, 6]],
            'chinaPublicHolidays' => ['timezone' => 'Asia/Shanghai', 'dates' => ['2026-01-01']],
            'models' => [
                [
                    'id' => 'deepseek-flash',
                    'cacheHit' => ['offPeak' => 0.003, 'peak' => 0.006],
                    'cacheMiss' => ['offPeak' => 0.15, 'peak' => 0.3],
                    'output' => ['offPeak' => 0.6, 'peak' => 1.2],
                ],
            ],
        ]));
    }

    protected function tearDown(): void
    {
        unlink($this->fixturePath);
    }

    public function testPeakWindows(): void
    {
        $config = new Config($this->fixturePath);
        $this->assertSame([['01:00', '04:00'], ['06:00', '10:00']], $config->peakWindows());
    }

    public function testWeekendOffPeak(): void
    {
        $config = new Config($this->fixturePath);
        $this->assertSame(['timezone' => 'Asia/Shanghai', 'days' => [0, 6]], $config->weekendOffPeak());
    }

    public function testChinaPublicHolidays(): void
    {
        $config = new Config($this->fixturePath);
        $this->assertSame(['timezone' => 'Asia/Shanghai', 'dates' => ['2026-01-01']], $config->chinaPublicHolidays());
    }

    public function testModels(): void
    {
        $config = new Config($this->fixturePath);
        $this->assertSame([
            [
                'id' => 'deepseek-flash',
                'cacheHit' => ['offPeak' => 0.003, 'peak' => 0.006],
                'cacheMiss' => ['offPeak' => 0.15, 'peak' => 0.3],
                'output' => ['offPeak' => 0.6, 'peak' => 1.2],
            ],
        ], $config->models());
    }

    public function testDefaultPathReadsRealConfig(): void
    {
        $config = new Config();
        $this->assertNotEmpty($config->peakWindows());
    }
}
