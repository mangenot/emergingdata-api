<?php
/**
 * Application-password login through the X-ED-Authorization header.
 *
 * Some servers (Apache with PHP-FPM or CGI) drop the standard Authorization header before PHP sees it, so WordPress
 * application passwords never work there. The publishing script sends the same "Basic <base64 user:password>" value
 * in X-ED-Authorization as well; when the standard header did not arrive, that value is handed to WordPress, which
 * then checks it exactly as it checks a normal application password (same rules, same errors, HTTPS required).
 */
if (!defined('ABSPATH')) exit;

(function () {
    if (isset($_SERVER['PHP_AUTH_USER']) || isset($_SERVER['PHP_AUTH_PW'])) return;          // the normal route worked
    if (isset($_SERVER['HTTP_AUTHORIZATION']) || isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) return;
    $header = $_SERVER['HTTP_X_ED_AUTHORIZATION'] ?? '';
    if ($header === '' || stripos($header, 'basic ') !== 0) return;
    $decoded = base64_decode(trim(substr($header, 6)), true);
    if ($decoded === false || strpos($decoded, ':') === false) return;
    [$user, $pass] = explode(':', $decoded, 2);
    if ($user === '' || $pass === '') return;
    $_SERVER['HTTP_AUTHORIZATION'] = $header;       // WordPress reads it from here and fills PHP_AUTH_USER / PHP_AUTH_PW
    if (function_exists('wp_populate_basic_auth_from_authorization_header')) wp_populate_basic_auth_from_authorization_header();
})();
