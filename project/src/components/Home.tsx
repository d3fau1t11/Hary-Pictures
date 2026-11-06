import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Instagram } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MediaCover from '../media/MediaCover';
import { supabase } from '../admin/supabaseClient';
// JWT error handling is now built into the fetch function



// Custom Telegram icon component
const TelegramIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.169 1.858-.896 6.728-.896 6.728-.896 6.728-1.277 5.66-1.277 5.66s-.17.34-.425.41c-.34.085-.596-.056-.596-.056l-2.55-1.888-1.445-1.002s-.255-.17-.17-.51c.085-.34.425-.68.425-.68l2.04-1.956s.255-.17.255-.425c0-.17-.17-.255-.17-.255L6.8 9.616s-.34-.085-.51.085c-.17.17-.085.425-.085.425l1.53 4.93s.085.34-.085.51c-.17.17-.425.085-.425.085l-1.956-.34s-.34-.085-.34-.34c0-.17.17-.34.17-.34l7.48-4.585s.34-.17.51-.085c.17.085.17.34.17.34l-1.53 4.93s-.085.34.085.51c.17.17.425.085.425.085l1.956.34s.34.085.34.34c0 .17-.17.34-.17.34l-2.55 1.888s-.34.17-.51.085c-.17-.085-.17-.34-.17-.34l1.53-4.93s.085-.34-.085-.51c-.17-.17-.425-.085-.425-.085l-1.956-.34s-.34-.085-.34-.34c0-.17.17-.34.17-.34l7.48-4.585s.34-.17.51-.085c.17.085.17.34.17.34z"/>
  </svg>
);

interface HomeProps {
  onPageChange: (page: string) => void;
}

// Supabase interfaces
interface Category {
  id: string;
  name_am: string;
  slug: string;
}

interface Picture {
  id: string;
  title: string;
  image_url: string;
  categories: Category | null;
}

interface PortfolioItem {
  title: string;
  size: 'large' | 'medium' | 'small';
  image: string;
}

const Home: React.FC<HomeProps> = () => {
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState<{ [key: string]: boolean }>({});
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  // const [heroLoading, setHeroLoading] = useState<boolean>(false);
  
  const heroRef = useRef<HTMLDivElement>(null);
  const portfolioRef = useRef<HTMLDivElement>(null);
  const quoteRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Handle category click - navigate to portfolio with category filter
  const handleCategoryClick = (categoryTitle: string) => {
    console.log('Category clicked:', categoryTitle);
    const url = `/portfolio?category=${encodeURIComponent(categoryTitle)}`;
    console.log('Navigating to:', url);
    navigate(url);
  };

  // Category covers may be photographs or stored video posters.
  const fetchPortfolioData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.from('pictures')
        .select('id,title,image_url,categories!inner(id,name_am,slug)');
      if (error) throw error;
      const categoryMap = new Map<string, Picture[]>();
      for (const row of data || []) {
        const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
        if (!category || ['hero', 'about-me', 'aboutme'].includes(category.slug.toLowerCase()) || ['hero', 'about me'].includes(category.name_am.toLowerCase().trim())) continue;
        const group = categoryMap.get(category.id) || [];
        group.push({ ...row, categories: category });
        categoryMap.set(category.id, group);
      }
      setPortfolioItems([...categoryMap.values()].map(group => {
        const item = group[Math.floor(Math.random() * group.length)];
        return { title: item.categories!.name_am, size: 'medium', image: item.image_url };
      }));
    } catch {
      setError('Unable to load the portfolio. Please try again.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchPortfolioData();
  }, []);

  // Fetch Hero image from Supabase (category: Hero / slug: hero)
  useEffect(() => {
    const fetchHeroImage = async () => {
      try {
        // setHeroLoading(true);
        // Find Hero category
        const { data: cat, error: catErr } = await supabase
          .from('categories')
          .select('id, name_am, slug')
          .eq('name_am', 'Hero')
          .eq('slug', 'hero')
          .single();

        if (catErr || !cat) {
          setHeroImageUrl(null);
          return;
        }

        // Get one image from Hero category
        const { data: pics, error: picsErr } = await supabase
          .from('pictures')
          .select('id, image_url')
          .eq('category_id', cat.id)
          .limit(1);

        if (picsErr || !pics || pics.length === 0) {
          setHeroImageUrl(null);
          return;
        }
        setHeroImageUrl(pics[0].image_url);
      } catch {
        setHeroImageUrl(null);
      } finally {
        // setHeroLoading(false);
      }
    };
    fetchHeroImage();
  }, []);

  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setIsVisible(prev => ({
            ...prev,
            [entry.target.id]: true
          }));
        }
      });
    }, observerOptions);

    const elements = [
      { ref: heroRef, id: 'hero' },
      { ref: portfolioRef, id: 'portfolio' },
      { ref: quoteRef, id: 'quote' },
      { ref: footerRef, id: 'footer' }
    ];

    elements.forEach(({ ref, id }) => {
      if (ref.current) {
        ref.current.id = id;
        observer.observe(ref.current);
      }
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section 
        ref={heroRef}
        className={`relative pt-32 pb-16 overflow-hidden transition-all duration-1000 ${
          isVisible['hero'] 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-10'
        }`}
      >
        {/* Background decorative elements */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Animated background circles */}
          <div className="absolute top-20 left-10 w-32 h-32 border border-white/10 rounded-full animate-pulse"></div>
          <div className="absolute top-40 right-20 w-20 h-20 border border-white/5 rounded-full animate-pulse delay-1000"></div>
          <div className="absolute bottom-20 left-1/4 w-16 h-16 border border-white/8 rounded-full animate-pulse delay-500"></div>
          
          {/* Subtle grid pattern */}
          <div className="absolute inset-0 opacity-5">
            <div className="w-full h-full" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
              backgroundSize: '50px 50px'
            }}></div>
          </div>
        </div>
        {/* Hero Content */}
        <div className="relative z-10 px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto mb-16">
            {/* Main title with enhanced styling */}
            <div className={`relative inline-block transition-all duration-1000 delay-300 ${
              isVisible['hero'] 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-10'
            }`}>
              <h1 className="text-6xl sm:text-7xl lg:text-8xl font-bold text-white mb-4 tracking-wider relative">
                <span className="relative z-10">Hary Pictures</span>
                {/* Text shadow effect */}
                <span className="absolute inset-0 text-transparent bg-gradient-to-r from-white/20 to-transparent bg-clip-text blur-sm">Hary Pictures</span>
              </h1>
              {/* Decorative line under title */}
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-32 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent"></div>
            </div>
            
            {/* Photography subtitle with enhanced styling */}
            <div className={`relative transition-all duration-1000 delay-500 ${
              isVisible['hero'] 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-10'
            }`}>
              <p className="text-lg sm:text-xl text-gray-300 mb-8 tracking-widest font-light relative">
                <span className="relative z-10">P H O T O G R A P H Y</span>
                {/* Subtle glow effect */}
                <span className="absolute inset-0 text-white/20 blur-sm">P H O T O G R A P H Y</span>
              </p>
            </div>
            
            {/* Enhanced divider */}
            <div className={`relative mx-auto mb-8 transition-all duration-1000 delay-700 ${
              isVisible['hero'] 
                ? 'opacity-100 scale-x-100' 
                : 'opacity-0 scale-x-0'
            }`}>
              <div className="w-24 h-px bg-gradient-to-r from-transparent via-white to-transparent"></div>
              <div className="absolute inset-0 w-24 h-px bg-white/50 blur-sm"></div>
            </div>
            
            {/* Description with enhanced styling */}
            <div className={`relative transition-all duration-1000 delay-900 ${
              isVisible['hero'] 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 translate-y-10'
            }`}>
              <p className="text-lg text-gray-300 leading-relaxed max-w-2xl mx-auto font-light relative">
                <span className="relative z-10">
                  A photographer based in Ethiopia specialized in graphic design, cinematography and event photography with 
                  a passion for capturing moments and telling stories through images.
                </span>
                {/* Subtle background highlight */}
                <span className="absolute inset-0 bg-white/5 rounded-lg blur-xl"></span>
              </p>
            </div>
            
            {/* Floating accent elements */}
            <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-white/40 rounded-full animate-ping delay-1000"></div>
              <div className="absolute top-1/3 right-1/3 w-0.5 h-0.5 bg-white/30 rounded-full animate-ping delay-1500"></div>
            </div>
          </div>

          {/* Large Hero Image */}
          <div className={`relative inline-block transition-all duration-1000 delay-1100 ${
            isVisible['hero'] 
              ? 'opacity-100 scale-100' 
              : 'opacity-0 scale-95'
          }`}>
            <div className="relative group">
              {heroImageUrl ? (
                <img 
                  src={heroImageUrl}
                  alt="Featured Hero"
                  className="block transition-all duration-700 group-hover:scale-105 group-hover:brightness-110"
                  loading="eager"
                />
              ) : (
                <img 
                  src="/Image/wide/wide1.jpg"
                  alt="Featured Photography Work"
                  className="block transition-all duration-700 group-hover:scale-105 group-hover:brightness-110"
                  loading="lazy"
                />
              )}
              {/* Creative overlay with gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-black/40 pointer-events-none transition-all duration-700 group-hover:from-black/10 group-hover:to-black/30"></div>
              
              {/* Animated border effect */}
              <div className="absolute inset-0 border-2 border-white/0 group-hover:border-white/20 transition-all duration-700"></div>
              
              {/* Floating particles effect */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-4 left-4 w-2 h-2 bg-white/30 rounded-full animate-pulse"></div>
                <div className="absolute top-8 right-8 w-1 h-1 bg-white/40 rounded-full animate-pulse delay-300"></div>
                <div className="absolute bottom-6 left-8 w-1.5 h-1.5 bg-white/25 rounded-full animate-pulse delay-700"></div>
                <div className="absolute bottom-4 right-4 w-1 h-1 bg-white/35 rounded-full animate-pulse delay-1000"></div>
              </div>
              
              {/* Subtle glow effect */}
              <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur-sm"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio Grid */}
      <section 
        ref={portfolioRef}
        className={`py-20 bg-black transition-all duration-1000 ${
          isVisible['portfolio'] 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-10'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-gray-300">Loading portfolio...</p>
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">Error loading portfolio: {error}</p>
              <button 
                onClick={fetchPortfolioData}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-auto">
            {portfolioItems.map((item, index) => (
              <div
                key={index}
                className={`group cursor-pointer transition-all duration-700 hover:scale-105 ${
                  item.size === 'large' ? 'sm:col-span-2 lg:col-span-2' :
                  item.size === 'medium' ? 'sm:col-span-1' :
                  'sm:col-span-1'
                } ${
                  isVisible['portfolio'] 
                    ? 'opacity-100 translate-y-0' 
                    : 'opacity-0 translate-y-10'
                }`}
                style={{
                  transitionDelay: `${index * 100}ms`
                }}
                role="link"
                tabIndex={0}
                aria-label={'Explore ' + item.title}
                onKeyDown={event => { if (event.key === 'Enter') handleCategoryClick(item.title); }}
                onClick={() => handleCategoryClick(item.title)}
              >
                {/* Image Container */}
                <div className={`relative overflow-hidden mb-4 ${
                  item.size === 'large' ? 'aspect-[4/3]' :
                  item.size === 'medium' ? 'aspect-[3/4]' :
                  'aspect-square'
                }`}>
                  <MediaCover
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full grayscale group-hover:grayscale-0 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-all duration-500"></div>
                  
                  {/* Hover Border Effect */}
                  <div className="absolute inset-0 border-2 border-white/0 group-hover:border-white/30 transition-all duration-500"></div>
                </div>

                {/* Title and Category Below Image */}
                <div className="text-center">
                  <h3 className="text-white font-bold text-sm mb-1 tracking-wide">
                    {item.title}
                  </h3>
                  {/* Removed category display since it's commented out in data */}
                </div>
              </div>
            ))}
          </div>
          )}

          {/* View Portfolio Button */}
          <div className={`text-center mt-16 transition-all duration-1000 delay-500 ${
            isVisible['portfolio'] 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-10'
          }`}>
            <button
              onClick={() => navigate('/portfolio')}
              className="group bg-transparent border border-white text-white hover:bg-white hover:text-black px-8 py-3 font-medium tracking-widest transition-all duration-300 flex items-center gap-2 mx-auto"
            >
              VIEW PORTFOLIO
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform duration-300" />
            </button>
          </div>
        </div>
      </section>

      {/* Quote Section */}
      <section 
        ref={quoteRef}
        className={`py-20 bg-slate-900 transition-all duration-1000 ${
          isVisible['quote'] 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-10'
        }`}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className={`w-24 h-px bg-white mx-auto mb-8 transition-all duration-1000 delay-300 ${
            isVisible['quote'] 
              ? 'opacity-100 scale-x-100' 
              : 'opacity-0 scale-x-0'
          }`}></div>
          <blockquote className={`text-2xl sm:text-3xl text-white font-light leading-relaxed tracking-wide mb-8 transition-all duration-1000 delay-500 ${
            isVisible['quote'] 
              ? 'opacity-100 translate-y-0' 
              : 'opacity-0 translate-y-10'
          }`}>
            "Just Like Your Beauty!"
          </blockquote>
          <div className={`w-24 h-px bg-white mx-auto transition-all duration-1000 delay-700 ${
            isVisible['quote'] 
              ? 'opacity-100 scale-x-100' 
              : 'opacity-0 scale-x-0'
          }`}></div>
        </div>
      </section>

      {/* Footer Info */}
      <section 
        ref={footerRef}
        className={`py-12 bg-black border-t border-gray-800 transition-all duration-1000 ${
          isVisible['footer'] 
            ? 'opacity-100 translate-y-0' 
            : 'opacity-0 translate-y-10'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center text-gray-400 text-sm">
            <p>Copyright © 2025</p>
            <div className="flex gap-6 mt-4 sm:mt-0">
              <a 
                href="https://www.instagram.com/hary_picture7" 
                className="hover:text-white transition-colors duration-300" 
                target="_blank" 
                rel="noopener noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={20} />
              </a>
              <a 
                href="https://t.me/harygraphic" 
                className="hover:text-white transition-colors duration-300" 
                target="_blank" 
                rel="noopener noreferrer"
                aria-label="Telegram"
              >
                <TelegramIcon size={20} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;