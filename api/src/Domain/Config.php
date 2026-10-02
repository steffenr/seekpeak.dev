<?php

namespace App\Domain;

final class Config
{
    private array $data;

    public function __construct(?string $path = null)
    {
        $path ??= __DIR__ . '/../../config.json';
        $json = file_get_contents($path);
        if ($json === false) {
            throw new \RuntimeException("Unable to read config file: {$path}");
        }
        $this->data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    }

    public function peakWindows(): array
    {
        return $this->data['peakWindows'];
    }

    public function weekendOffPeak(): array
    {
        return $this->data['weekendOffPeak'];
    }

    public function chinaPublicHolidays(): array
    {
        return $this->data['chinaPublicHolidays'];
    }
}
