import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Home from './components/Home';
import Portfolio from './components/Portfolio';
import About from './components/About';
import Services from './components/Services';
import Contact from './components/Contact';
import AdminGate from './admin/AdminGate';
import NotFound from './components/NotFound';

// Component to handle routing logic
function AppContent() {
  const [currentPage, setCurrentPage] = useState('home');
  const location = useLocation();

  React.useEffect(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // Update currentPage based on URL
  React.useEffect(() => {
    const path = location.pathname;
    if (path === '/') setCurrentPage('home');
    else if (path === '/portfolio') setCurrentPage('portfolio');
    else if (path === '/about') setCurrentPage('about');
    else if (path === '/services') setCurrentPage('services');
    else if (path === '/contact') setCurrentPage('contact');
    else if (path === '/admin') setCurrentPage('admin');
  }, [location]);

  // Update canonical URL and meta description per route for SEO
  React.useEffect(() => {
    const baseUrl = 'https://harypictures.netlify.app';
    const pathname = location.pathname;
    const search = location.search || '';
    const canonicalUrl = `${baseUrl}${pathname}${search}`;

    // Ensure a single canonical link exists and points to the current route
    let canonicalLink = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);

    // Route-specific titles and descriptions
    const titles: Record<string, string> = {
      '/': 'Hary Pictures - Professional Photographer',
      '/portfolio': 'Portfolio - Hary Pictures',
      '/about': 'About Hary Pictures',
      '/services': 'Photography Services - Hary Pictures',
      '/contact': 'Contact - Hary Pictures'
    };

    const defaultDescription = 'Professional photographer specializing in weddings, portraits, graphical design and events in Ethiopia.';
    const descriptions: Record<string, string> = {
      '/': defaultDescription,
      '/portfolio': 'Explore a curated selection of wedding, portrait, and event photography by Hary Pictures.',
      '/about': 'Learn about Hary Pictures — a professional photographer based in Addis Ababa, Ethiopia.',
      '/services': 'Wedding, portrait, event photography, and graphic design services tailored to your needs.',
      '/contact': 'Get in touch with Hary Pictures for bookings, inquiries, and collaborations.'
    };

    document.title = titles[pathname] || 'Hary Pictures';

    let metaDescription = document.querySelector("meta[name='description']") as HTMLMetaElement | null;
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', descriptions[pathname] || defaultDescription);
  }, [location]);

  const Content = /^\/admin(?:\/|$)/.test(location.pathname) ? 'div' : 'main';
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 dark:from-slate-900 dark:via-blue-900 dark:to-slate-800">
      {!/^\/admin(?:\/|$)/.test(location.pathname) && <Header currentPage={currentPage} onPageChange={setCurrentPage} />}
      <Content>
        <Routes>
          <Route path="/" element={<Home onPageChange={setCurrentPage} />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services onPageChange={setCurrentPage} />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/admin/*" element={<AdminGate />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Content>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
