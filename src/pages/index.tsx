
import { Link } from 'gatsby';
import * as React from 'react';
import Layout from '../components/Layout';

export default function Index() {
    return <Layout>
        <h1>The Holy Bible</h1>
        <h3>Translations:</h3>
        <ul>
            <li><Link to="/read/BSB/Genesis/1">BSB</Link></li>
        </ul>
        <h3>API</h3>
        <p>Want to make the Bible accessible in your app/website? Use our <a href="/docs">API</a>!</p>
    </Layout>
}