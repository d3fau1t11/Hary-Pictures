import React, { useState, useEffect, useRef } from 'react';
import { Mail, Phone, MapPin, Clock, Send, Instagram, CheckCircle, AlertCircle, User, MessageSquare, Calendar, Camera, ArrowRight } from 'lucide-react';
import { supabase } from '../admin/supabaseClient';

// Custom Telegram SVG component
const TelegramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width={props.width || 20}
    height={props.height || 20}
    {...props}
  >
    <path
      d="M21.944 3.685a1.5 1.5 0 0 0-1.62-.23L3.5 10.5a1.5 1.5 0 0 0 .13 2.78l4.47 1.6 1.6 4.47a1.5 1.5 0 0 0 2.78.13l7.045-16.824a1.5 1.5 0 0 0-.481-1.971zM10.5 19.5l-1.6-4.47-4.47-1.6L20.5 4.5l-7.045 16.824a.5.5 0 0 1-.955-.176z"
      fill="currentColor"
    />
  </svg>
);

interface FormData {
  name: string;
  contactType: 'email' | 'telegram';
  email: string;
  telegram: string;
  phone: string;
  service: string;
  date: string;
  message: string;
}

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const Contact: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    contactType: 'email',
    email: '',
    telegram: '',
    phone: '',
    service: '',
    date: '',
    message: ''
  });

  const [formStatus, setFormStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [focusedField, setFocusedField] = useState<string>('');
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [submissionAttempts, setSubmissionAttempts] = useState<number>(0);
  const [lastSubmissionTime, setLastSubmissionTime] = useState<number>(0);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [telegramValidationStatus, setTelegramValidationStatus] = useState<'idle' | 'valid' | 'invalid' | 'checking'>('idle');
  const [emailValidationStatus, setEmailValidationStatus] = useState<'idle' | 'valid' | 'invalid' | 'checking'>('idle');

  // Refs for form fields
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const telegramRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const serviceRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // Security utility functions
  const sanitizeInput = (input: string): string => {
    return input
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  };

  // Special sanitization for message field to preserve spaces
  const sanitizeMessage = (input: string): string => {
    // Only remove potentially dangerous content, preserve all spaces including leading spaces
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]*>/g, '') // Remove any remaining HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  };

  const validatePhone = (phone: string): boolean => {
    // Validate Ethiopian phone format: 0[1-9][0-9]{7,8} (matches DB constraint)
    const phoneRegex = /^0[1-9][0-9]{7,8}$/;
    return phoneRegex.test(phone);
  };

  const validateName = (name: string): boolean => {
    return name.length >= 2 && name.length <= 100 && /^[a-zA-Z\s\-'\.]+$/.test(name);
  };

  const validateMessage = (message: string): boolean => {
    return message.length > 0 && message.length <= 2000;
  };

  const isRateLimited = (): boolean => {
    const now = Date.now();
    const timeSinceLastSubmission = now - lastSubmissionTime;
    const maxAttempts = 5;
    const timeWindow = 15 * 60 * 1000; // 15 minutes

    if (timeSinceLastSubmission > timeWindow) {
      setSubmissionAttempts(0);
      return false;
    }

    return submissionAttempts >= maxAttempts;
  };

  // Utility functions
  const formatPhoneNumber = (value: string) => {
    // Remove all non-digit characters
    const phoneNumber = value.replace(/\D/g, '');
    
    // Format as 0XXXXXXXXX for Ethiopian numbers
    if (phoneNumber.length <= 10) {
      // If it starts with 0, keep it as is
      if (phoneNumber.startsWith('0')) {
        return phoneNumber;
      }
      // If it doesn't start with 0, add 0 prefix
      return '0' + phoneNumber;
    }
    
    return phoneNumber;
  };

  const formatTelegramUsername = (value: string) => {
    // Remove @ if user added it manually (since we show it visually)
    const cleanValue = value.startsWith('@') ? value.slice(1) : value;
    
    // Only remove spaces and special characters, keep letters, numbers, underscores
    const sanitizedValue = cleanValue.replace(/[^a-zA-Z0-9_]/g, '');
    
    // Return without @ prefix since it's shown visually
    return sanitizedValue;
  };

  const focusNextField = (currentField: string) => {
    const fieldOrder = ['name', 'email', 'telegram', 'phone', 'service', 'date', 'message'];
    const currentIndex = fieldOrder.indexOf(currentField);
    if (currentIndex < fieldOrder.length - 1) {
      const nextField = fieldOrder[currentIndex + 1];
      const refs = { name: nameRef, email: emailRef, telegram: telegramRef, phone: phoneRef, service: serviceRef, date: dateRef, message: messageRef };
      refs[nextField as keyof typeof refs]?.current?.focus();
    }
  };

  // Generate CSRF token on component mount
  useEffect(() => {
    const generateCSRFToken = () => {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    };
    setCsrfToken(generateCSRFToken());
  }, []);

  // Function to get client IP (limited on client-side)
  const getClientIP = async (): Promise<string> => {
    try {
      // Try to get IP from a public service (fallback method)
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip || 'unknown';
    } catch (error) {
      console.log('Could not fetch IP address:', error);
      return 'client-side';
    }
  };

  // Auto-save to localStorage
  useEffect(() => {
    localStorage.setItem('contactFormDraft', JSON.stringify(formData));
  }, [formData]);

  // Load draft from localStorage on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem('contactFormDraft');
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        setFormData(draftData);
      } catch (error) {
        console.error('Error loading form draft:', error);
      }
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFormData({
          name: '',
          contactType: 'email',
          email: '',
          telegram: '',
          phone: '',
          service: '',
          date: '',
          message: ''
        });
        localStorage.removeItem('contactFormDraft');
        nameRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Telegram message sending function using Netlify function
  const sendTelegramMessage = async (message: string) => {
    try {
      const response = await fetch("/.netlify/functions/sendTelegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        console.error("Netlify function error:", response.status, response.statusText);
        return;
      }

    } catch (error) {
      console.error("Error calling Telegram function:", error);
    }
  };

  // Enhanced Telegram username validation (matches DB constraint)
  const validateTelegramUsername = (username: string): boolean => {
    if (!username || username.trim() === '') return true; // Optional field
    
    // Remove @ if present
    const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
    
    // DB constraint: ^[A-Za-z0-9_]{5,32}$ (simplified from original Telegram rules)
    const telegramRegex = /^[A-Za-z0-9_]{5,32}$/;
    return telegramRegex.test(cleanUsername);
  };

  // Debounced validation for real-time feedback
  const debouncedTelegramValidation = useRef<NodeJS.Timeout | null>(null);
  const debouncedEmailValidation = useRef<NodeJS.Timeout | null>(null);
  
  const validateTelegramRealTime = (username: string) => {
    if (debouncedTelegramValidation.current) {
      clearTimeout(debouncedTelegramValidation.current);
    }
    
    if (!username || username.trim() === '') {
      setTelegramValidationStatus('idle');
      return;
    }
    
    setTelegramValidationStatus('checking');
    
    debouncedTelegramValidation.current = setTimeout(() => {
      const isValid = validateTelegramUsername(username);
      setTelegramValidationStatus(isValid ? 'valid' : 'invalid');
    }, 500);
  };

  const validateEmailRealTime = (email: string) => {
    if (debouncedEmailValidation.current) {
      clearTimeout(debouncedEmailValidation.current);
    }
    
    if (!email || email.trim() === '') {
      setEmailValidationStatus('idle');
      return;
    }
    
    setEmailValidationStatus('checking');
    
    debouncedEmailValidation.current = setTimeout(() => {
      const isValid = validateEmail(email);
      setEmailValidationStatus(isValid ? 'valid' : 'invalid');
    }, 500);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // Special handling for different field types
    if (name === 'phone') {
      const formattedPhone = formatPhoneNumber(value);
      setFormData(prev => ({
        ...prev,
        [name]: formattedPhone
      }));
    } else if (name === 'email') {
      const sanitizedValue = sanitizeInput(value);
      setFormData(prev => ({
        ...prev,
        [name]: sanitizedValue
      }));
      // Real-time validation
      validateEmailRealTime(sanitizedValue);
    } else if (name === 'telegram') {
      const formattedTelegram = formatTelegramUsername(value);
      setFormData(prev => ({
        ...prev,
        [name]: formattedTelegram
      }));
      // Real-time validation
      validateTelegramRealTime(formattedTelegram);
    } else if (name === 'message') {
      // Use special sanitization for message to preserve spaces
      const messageValue = sanitizeMessage(value);
      setFormData(prev => ({
        ...prev,
        [name]: messageValue
      }));
    } else {
      // Sanitize other inputs to prevent XSS attacks
      const sanitizedValue = sanitizeInput(value);
      setFormData(prev => ({
        ...prev,
        [name]: sanitizedValue
      }));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, fieldName: string) => {
    if (e.key === 'Enter' && fieldName !== 'message') {
      e.preventDefault();
      focusNextField(fieldName);
    } else if (e.key === 'Enter' && fieldName === 'message' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const handleFieldFocus = (fieldName: string) => {
    setFocusedField(fieldName);
  };

  const handleFieldBlur = () => {
    setFocusedField('');
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormStatus('submitting');
    setErrorMessage('');


    try {
      // Honeypot check - if filled, it's likely a bot
      const formDataObj = new FormData(e.currentTarget);
      const honeypot = formDataObj.get('website');
      if (honeypot && honeypot.toString().trim() !== '') {
        console.log('Bot detected via honeypot');
        setFormStatus('error');
        setErrorMessage('Invalid submission detected.');
        setShowErrorPopup(true);
        return;
      }

      // Rate limiting check
      if (isRateLimited()) {
        setFormStatus('error');
        setErrorMessage('Too many submission attempts. Please wait 15 minutes before trying again.');
        setShowErrorPopup(true);
        return;
      }

      // Comprehensive validation
      if (!validateName(formData.name)) {
        setFormStatus('error');
        setErrorMessage('Please enter a valid name (2-100 characters, letters only).');
        setShowErrorPopup(true);
        return;
      }

      if (formData.contactType === 'email' && !validateEmail(formData.email)) {
        setFormStatus('error');
        setErrorMessage('Please enter a valid email address.');
        setShowErrorPopup(true);
        return;
      }

      // Check if at least one contact method is provided (matches DB constraint)
      const hasEmail = formData.contactType === 'email' && formData.email && formData.email.trim() !== '';
      const hasTelegram = formData.contactType === 'telegram' && formData.telegram && formData.telegram.trim() !== '';
      const hasPhone = formData.phone && formData.phone.trim() !== '';
      
      if (!hasEmail && !hasTelegram && !hasPhone) {
        setFormStatus('error');
        setErrorMessage('Please provide at least one contact method: email, Telegram username, or phone number.');
        setShowErrorPopup(true);
        return;
      }

      if (formData.contactType === 'telegram' && formData.telegram && !validateTelegramUsername(formData.telegram)) {
        setFormStatus('error');
        setErrorMessage('Please enter a valid Telegram username. Must be 5-32 characters and can only contain letters, numbers, and underscores.');
        setShowErrorPopup(true);
        return;
      }

      if (formData.phone && !validatePhone(formData.phone)) {
        setFormStatus('error');
        setErrorMessage('Please enter a valid Ethiopian phone number in format: 0912345678 (0 followed by 1-9, then 7-8 more digits).');
        setShowErrorPopup(true);
        return;
      }

      if (!validateMessage(formData.message)) {
        setFormStatus('error');
        setErrorMessage('Please enter a message (maximum 2000 characters).');
        setShowErrorPopup(true);
        return;
      }

      // Get client IP address
      const clientIP = await getClientIP();

      // Sanitize all data before sending (matches DB constraints)
      const sanitizedData = {
        name: sanitizeInput(formData.name),
        email: formData.contactType === 'email' ? sanitizeInput(formData.email) : '',
        telegram_username: formData.contactType === 'telegram' && formData.telegram ? sanitizeInput(formData.telegram) : '',
        phone: sanitizeInput(formData.phone) || '',
        service: sanitizeInput(formData.service),
        date: formData.date,
        message: sanitizeMessage(formData.message).trim(),
        contact_type: formData.contactType,
        ip_address: clientIP,
        user_agent: navigator.userAgent,
        csrf_token: csrfToken
      };

      // Store in Supabase
      const { error } = await supabase
        .from('contact_messages')
        .insert([sanitizedData]);

      if (error) {
        console.error('Contact submission was rejected.');
        
        // Handle specific database constraint error
        if (error.message.includes('check_telegram_format')) {
          setFormStatus('error');
          setErrorMessage('Please choose Email instead of Telegram if you don\'t have a Telegram username, or provide a valid Telegram username.');
          setShowErrorPopup(true);
          return;
        }
        
        throw new Error('Your message could not be saved. Please try again.');
      }

      console.log('Data successfully stored in Supabase');

      // Prepare modern Telegram message with sanitized data
      const contactInfoMsg = formData.contactType === 'email' 
        ? `✉️ Email: ${sanitizedData.email}`
        : `📱 Telegram: ${sanitizedData.telegram_username ? `@${sanitizedData.telegram_username}` : 'Not provided'}`;
      
      const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        try {
          const date = new Date(dateString);
          return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        } catch {
          return dateString;
        }
      };

      const formatTimestamp = () => {
        const now = new Date();
        return now.toLocaleString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      };

      const message = `
🆕 New Contact Form Submission ────────────
👤 Name: ${sanitizedData.name}
${contactInfoMsg}
📞 Phone: ${sanitizedData.phone || 'N/A'}

🖼️ Service: ${sanitizedData.service || 'N/A'}
📅 Preferred Date: ${formatDate(sanitizedData.date)}

💬 Message:
${sanitizedData.message}

⏱️ Submitted: ${formatTimestamp()}
───────────────────────────────
      `.trim();

      // Send to Telegram
      console.log('Sending Telegram message...');
      await sendTelegramMessage(message);

      // Update rate limiting
      setSubmissionAttempts(prev => prev + 1);
      setLastSubmissionTime(Date.now());

      setFormStatus('success');
      setShowSuccessAnimation(true);
      localStorage.removeItem('contactFormDraft');
      setFormData({
        name: '',
        contactType: 'email',
        email: '',
        telegram: '',
        phone: '',
        service: '',
        date: '',
        message: ''
      });
      
      // Hide success animation after 3 seconds
      setTimeout(() => setShowSuccessAnimation(false), 3000);
    } catch (err) {
      console.error('Contact submission failed.');
      setFormStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong. Try again.'
      );
      setShowErrorPopup(true);
    }
  };

  const contactInfo = [
    {
      icon: Mail,
      title: 'Email',
      value: 'harypictures7@gmail.com',
    },
    {
      icon: Phone,
      title: 'Phone',
      value: '+251945283851',      
    },
    {
      icon: Phone,
      title: 'Phone',
      value: '+25198 693 4104',
    },
    {
      icon: MapPin,
      title: 'Location',
      value: 'Addis Ababa, A.A',
    },
    {
      icon: Clock,
      title: 'Hours',
      value: 'Mon-Fri: 3AM-6PM',
    }
  ];

  const socialLinks = [
    { icon: Instagram, name: 'Instagram', url: 'https://www.instagram.com/hary_picture7', handle: '@hary_picture7' },
    { icon: TelegramIcon, name: 'Telegram', url: 'https://t.me/harygraphic', handle: '@harygraphic' },
  ];

  return (
    <div className="min-h-screen pt-20 relative overflow-hidden bg-black selection:bg-blue-500/30 selection:text-blue-200">
      {/* Animated Abstract Background Grid & Bokeh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(to_right,#1f293702_1px,transparent_1px),linear-gradient(to_bottom,#1f293702_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-gradient-to-br from-blue-600/10 via-purple-600/5 to-transparent rounded-full blur-3xl animate-pulse duration-[8000ms]"></div>
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] bg-gradient-to-tr from-cyan-600/10 via-emerald-600/5 to-transparent rounded-full blur-3xl animate-pulse duration-[10000ms] delay-1000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-full blur-3xl animate-pulse duration-[12000ms] delay-500"></div>
      </div>

      {/* Floating lens-flare circles */}
      <div className="absolute top-[15%] left-[5%] w-72 h-72 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 rounded-full blur-2xl animate-pulse duration-5000"></div>
      <div className="absolute bottom-[20%] right-[10%] w-96 h-96 bg-gradient-to-tl from-purple-500/5 to-pink-500/5 rounded-full blur-3xl animate-pulse duration-7000"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pb-24">
        {/* Dynamic Page Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 pt-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
            <Camera className="w-4 h-4" />
            <span>Connect & Create</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight mb-6">
            Let's Capture Your <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">Story</span>
          </h1>
          <p className="text-gray-400 text-lg sm:text-xl leading-relaxed">
            Have a project in mind, a wedding to document, or want to collaborate? Reach out below and let's bring your vision to life.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Viewfinder Camera Mockup & Info Panel */}
          <div className="lg:col-span-5 space-y-8">
            {/* Viewfinder Preview */}
            <div className="relative group overflow-hidden bg-slate-900/60 backdrop-blur-md rounded-3xl border border-slate-800/80 shadow-2xl p-6 transition-all duration-500 hover:border-blue-500/30">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/20 to-slate-950/50 pointer-events-none"></div>
              
              {/* Camera Viewfinder Elements */}
              {/* Corner brackets */}
              <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-slate-600 group-hover:border-blue-400 transition-colors duration-300"></div>
              <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-slate-600 group-hover:border-blue-400 transition-colors duration-300"></div>
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-slate-600 group-hover:border-blue-400 transition-colors duration-300"></div>
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-slate-600 group-hover:border-blue-400 transition-colors duration-300"></div>
              
              {/* Center Crosshairs */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity duration-300">
                <div className="w-8 h-8 border border-white rounded-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                </div>
              </div>

              {/* Viewfinder status overlay */}
              <div className="flex justify-between items-center text-xs font-mono text-slate-400 mb-8 relative z-10">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  <span className="text-red-500 font-bold tracking-wider">REC</span>
                </div>
                <div>RAW 16bit</div>
                <div className="flex items-center gap-1">
                  <span>ISO 100</span>
                  <span className="text-slate-600">|</span>
                  <span>f/1.8</span>
                  <span className="text-slate-600">|</span>
                  <span>1/250s</span>
                </div>
              </div>

              {/* Viewfinder display text */}
              <div className="py-10 text-center relative z-10">
                <p className="text-sm font-mono text-blue-400 uppercase tracking-widest mb-2">Focal Point</p>
                <h3 className="text-2xl font-bold text-white tracking-wide mb-4">
                  {formData.name ? `Subject: ${formData.name}` : "Every Frame Tells a Story"}
                </h3>
                <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
                  "Photography is the story I fail to put into words." Let's create something timeless.
                </p>
              </div>

              {/* Dynamic Camera Settings Panel */}
              <div className="mt-8 pt-6 border-t border-slate-800/80 flex justify-between items-center font-mono text-[10px] sm:text-xs text-slate-400 relative z-10">
                <div>
                  <span className="text-slate-500">MODE: </span>
                  <span className="text-cyan-400 font-bold uppercase">
                    {formData.service ? `${formData.service}` : 'MANUAL'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">DATE: </span>
                  <span className="text-emerald-400 font-bold">
                    {formData.date ? `${formData.date}` : new Date().toISOString().split('T')[0]}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">FOCUS: </span>
                  <span className="text-purple-400 font-bold">AF-S</span>
                </div>
              </div>
            </div>

            {/* Contact Details List */}
            <div className="grid grid-cols-1 gap-4">
              {contactInfo.map((info, index) => {
                const isCopyable = info.title === 'Email' || info.title === 'Phone';
                return (
                  <div
                    key={index}
                    onClick={isCopyable ? async () => {
                      await navigator.clipboard.writeText(info.value);
                      setCopiedIndex(index);
                      setTimeout(() => setCopiedIndex(null), 1500);
                    } : undefined}
                    className={`group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/40 backdrop-blur-sm p-4 flex items-center transition-all duration-300 ${
                      isCopyable ? 'cursor-pointer hover:border-blue-500/20 hover:bg-slate-900/60 hover:-translate-y-1' : 'cursor-default'
                    }`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/10 p-3 rounded-xl mr-4 text-blue-400 group-hover:scale-110 transition-transform duration-300">
                      <info.icon size={20} />
                    </div>
                    <div className="flex-1">
                      <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">{info.title}</span>
                      <p className="text-slate-200 text-sm font-medium mt-0.5">
                        {info.value}
                        {copiedIndex === index && (
                          <span className="ml-2 text-green-400 font-bold text-[10px] animate-pulse">✓ Copied</span>
                        )}
                      </p>
                    </div>
                    {isCopyable && (
                      <div className="text-slate-600 group-hover:text-blue-400 transition-colors duration-300 pr-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Social Links Panel */}
            <div className="bg-slate-900/40 backdrop-blur-sm rounded-3xl border border-slate-800/60 p-6">
              <h4 className="text-white font-bold text-sm uppercase tracking-wider mb-4 text-center sm:text-left">Follow My Journey</h4>
              <div className="grid grid-cols-2 gap-4">
                {socialLinks.map((social, index) => (
                  <a
                    key={index}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-cyan-500/20 hover:bg-slate-800/60 transition-all duration-300 hover:-translate-y-0.5"
                  >
                    <div className="bg-slate-800 p-2.5 rounded-xl text-slate-400 group-hover:text-cyan-400 group-hover:bg-cyan-500/10 transition-all duration-300 mr-3">
                      <social.icon size={18} />
                    </div>
                    <div>
                      <div className="text-slate-200 text-xs font-bold">{social.name}</div>
                      <div className="text-slate-500 text-[10px]">{social.handle}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Form Container */}
          <div className="lg:col-span-7 relative">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600/30 via-purple-600/30 to-cyan-600/30 rounded-[32px] blur-md opacity-70"></div>
            
            <div className="relative bg-slate-900/90 backdrop-blur-md rounded-3xl p-6 sm:p-10 shadow-2xl border border-slate-800/80 overflow-hidden">
              {/* Form subtle glass elements */}
              <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
              
              {/* Success Animation Overlay */}
              {showSuccessAnimation && (
                <div className="absolute inset-0 bg-slate-950/90 flex items-center justify-center z-50">
                  <div className="text-center p-8 max-w-md">
                    <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/30 animate-bounce">
                      <CheckCircle size={40} className="text-green-400" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-2">Message Transmitted!</h3>
                    <p className="text-slate-400 mb-6">
                      Thank you for choosing Hary Pictures. I'll get back to you within 24 hours.
                    </p>
                    <button 
                      onClick={() => setShowSuccessAnimation(false)}
                      className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Form Title & Sub */}
              <div className="mb-8">
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Send Me a Message</h2>
                <p className="text-slate-400 text-xs sm:text-sm mt-2">
                  Have an event or project in mind? Let's discuss details and tailor a custom session.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Hidden CSRF Token */}
                <input type="hidden" name="csrf_token" value={csrfToken} />
                
                {/* Honeypot field */}
                <div style={{ display: 'none' }}>
                  <label htmlFor="website">Website (leave empty):</label>
                  <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" />
                </div>

                {/* Name field */}
                <div className="relative group">
                  <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300">
                    <User size={18} />
                  </span>
                  <input
                    ref={nameRef}
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    onKeyDown={(e) => handleKeyDown(e, 'name')}
                    onFocus={() => handleFieldFocus('name')}
                    onBlur={handleFieldBlur}
                    required
                    placeholder="Your Full Name"
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:bg-slate-950 transition-all duration-300"
                  />
                </div>

                {/* Toggle & Contact Input Area */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                  {/* Contact Type Toggle */}
                  <div className="md:col-span-5">
                    <div className="flex bg-slate-950/80 border border-slate-800/80 p-1 rounded-2xl relative">
                      <div 
                        className="absolute top-1 bottom-1 bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl transition-all duration-300 ease-out"
                        style={{
                          left: formData.contactType === 'email' ? '4px' : 'calc(50% + 2px)',
                          width: 'calc(50% - 6px)'
                        }}
                      />
                      
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, contactType: 'email' }));
                          handleFieldFocus('contactType');
                          if (formData.email) validateEmailRealTime(formData.email);
                        }}
                        className={`relative z-10 flex-1 py-2 text-center text-xs font-semibold transition-colors duration-300 flex items-center justify-center gap-1.5 ${
                          formData.contactType === 'email' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Mail size={14} />
                        <span>Email</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({ ...prev, contactType: 'telegram' }));
                          handleFieldFocus('contactType');
                          setEmailValidationStatus('idle');
                        }}
                        className={`relative z-10 flex-1 py-2 text-center text-xs font-semibold transition-colors duration-300 flex items-center justify-center gap-1.5 ${
                          formData.contactType === 'telegram' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <TelegramIcon size={14} />
                        <span>Telegram</span>
                      </button>
                    </div>
                  </div>

                  {/* Dynamic Contact Field (Email or Telegram) */}
                  <div className="md:col-span-7">
                    <div className="relative group">
                      {formData.contactType === 'email' ? (
                        <>
                          <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300">
                            <Mail size={18} />
                          </span>
                          <input
                            ref={emailRef}
                            type="email"
                            id="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            onKeyDown={(e) => handleKeyDown(e, 'email')}
                            onFocus={() => handleFieldFocus('email')}
                            onBlur={handleFieldBlur}
                            required={formData.contactType === 'email'}
                            placeholder="your@email.com"
                            className={`w-full pl-12 pr-10 py-3.5 bg-slate-950/60 border rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:bg-slate-950 transition-all duration-300 ${
                              emailValidationStatus === 'valid' ? 'border-green-500/40' :
                              emailValidationStatus === 'invalid' ? 'border-red-500/40' : 'border-slate-800/80 focus:border-blue-500/50'
                            }`}
                          />
                          {formData.email && emailValidationStatus !== 'idle' && (
                            <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
                              {emailValidationStatus === 'checking' && <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>}
                              {emailValidationStatus === 'valid' && <CheckCircle size={16} className="text-green-400" />}
                              {emailValidationStatus === 'invalid' && <AlertCircle size={16} className="text-red-400" />}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300">
                            <TelegramIcon size={18} />
                          </span>
                          <span className="absolute left-10 top-1/2 transform -translate-y-1/2 text-slate-200 font-semibold text-sm select-none pointer-events-none">
                            @
                          </span>
                          <input
                            ref={telegramRef}
                            type="text"
                            id="telegram"
                            name="telegram"
                            value={formData.telegram.startsWith('@') ? formData.telegram.slice(1) : formData.telegram}
                            onChange={handleInputChange}
                            onKeyDown={(e) => handleKeyDown(e, 'telegram')}
                            onFocus={() => handleFieldFocus('telegram')}
                            onBlur={handleFieldBlur}
                            placeholder="username"
                            className={`w-full pl-16 pr-10 py-3.5 bg-slate-950/60 border rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:bg-slate-950 transition-all duration-300 ${
                              telegramValidationStatus === 'valid' ? 'border-green-500/40' :
                              telegramValidationStatus === 'invalid' ? 'border-red-500/40' : 'border-slate-800/80 focus:border-blue-500/50'
                            }`}
                          />
                          {formData.telegram && telegramValidationStatus !== 'idle' && (
                            <span className="absolute right-4 top-1/2 transform -translate-y-1/2">
                              {telegramValidationStatus === 'checking' && <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>}
                              {telegramValidationStatus === 'valid' && <CheckCircle size={16} className="text-green-400" />}
                              {telegramValidationStatus === 'invalid' && <AlertCircle size={16} className="text-red-400" />}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Phone & Service */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Phone */}
                  <div className="relative group">
                    <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300">
                      <Phone size={18} />
                    </span>
                    <input
                      ref={phoneRef}
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      onKeyDown={(e) => handleKeyDown(e, 'phone')}
                      onFocus={() => handleFieldFocus('phone')}
                      onBlur={handleFieldBlur}
                      placeholder="Phone Number (e.g. 0912345678)"
                      className="w-full pl-12 pr-4 py-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:bg-slate-950 transition-all duration-300"
                    />
                  </div>

                  {/* Service */}
                  <div className="relative group">
                    <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300 pointer-events-none">
                      <Camera size={18} />
                    </span>
                    <select
                      ref={serviceRef}
                      id="service"
                      name="service"
                      value={formData.service}
                      onChange={handleInputChange}
                      onKeyDown={(e) => handleKeyDown(e, 'service')}
                      onFocus={() => handleFieldFocus('service')}
                      onBlur={handleFieldBlur}
                      className="w-full pl-12 pr-10 py-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:bg-slate-950 appearance-none cursor-pointer transition-all duration-300"
                    >
                      <option value="" className="bg-slate-950">Select Photography Service</option>
                      <option value="wedding" className="bg-slate-950">Wedding / Engagement Photography</option>
                      <option value="portrait" className="bg-slate-950">Portrait / Studio Session</option>
                      <option value="Street photography" className="bg-slate-950">Street & Urban Photography</option>
                      <option value="Real estate photography" className="bg-slate-950">Real Estate & Space Photography</option>
                      <option value="other" className="bg-slate-950">Other Event / Commercial shoot</option>
                    </select>
                    <span className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-500 pointer-events-none">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </div>
                </div>

                {/* Preferred Date */}
                <div className="relative group">
                  <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300 pointer-events-none">
                    <Calendar size={18} />
                  </span>
                  <input
                    ref={dateRef}
                    type="date"
                    id="date"
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                    onKeyDown={(e) => handleKeyDown(e, 'date')}
                    onFocus={() => handleFieldFocus('date')}
                    onBlur={handleFieldBlur}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:bg-slate-950 transition-all duration-300 cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  />
                  <div className="absolute right-12 top-1/2 transform -translate-y-1/2 pointer-events-none text-xs text-slate-500 select-none hidden sm:block">
                    Preferred shoot date (optional)
                  </div>
                </div>

                {/* Message */}
                <div className="relative group">
                  <span className="absolute left-4 top-4 text-slate-500 group-focus-within:text-blue-400 transition-colors duration-300">
                    <MessageSquare size={18} />
                  </span>
                  <textarea
                    ref={messageRef}
                    id="message"
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    onKeyDown={(e) => handleKeyDown(e, 'message')}
                    onFocus={() => handleFieldFocus('message')}
                    onBlur={handleFieldBlur}
                    required
                    rows={5}
                    placeholder="Tell me about your details, location, style preferences, and any thoughts you have..."
                    className="w-full pl-12 pr-4 py-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:bg-slate-950 resize-none transition-all duration-300"
                  />
                  
                  <div className="flex justify-between text-[10px] text-slate-500 mt-2 px-1">
                    <span>
                      {formData.message.length > 0 && `${formData.message.length} / 2000 characters`}
                    </span>
                    <span className="hidden sm:inline">Press Enter to send (Shift + Enter for new line)</span>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={formStatus === 'submitting'}
                  className="group w-full relative bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:from-slate-800 disabled:to-slate-800 text-white py-4 rounded-2xl font-bold tracking-wide transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/10 hover:shadow-cyan-500/20 transform hover:-translate-y-0.5 disabled:transform-none disabled:cursor-not-allowed overflow-hidden"
                >
                  {formStatus === 'submitting' ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      <span>Sending inquiry...</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} className="group-hover:translate-x-1 group-hover:-translate-y-0.5 transition-transform duration-300" />
                      <span>Transmit Shoot Request</span>
                      <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Modern Error Popup */}
      {showErrorPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setShowErrorPopup(false)}
          />
          <div className="relative bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl transform animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowErrorPopup(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors duration-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="flex items-center justify-center w-16 h-16 bg-red-500/10 rounded-2xl mx-auto mb-6 border border-red-500/20">
              <AlertCircle size={32} className="text-red-400" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-white mb-3">
                {errorMessage.includes('Telegram') ? 'Telegram Username Required' : 'Inquiry Error'}
              </h3>
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                {errorMessage}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowErrorPopup(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-2xl font-semibold transition-all duration-200"
                >
                  Dismiss
                </button>
                {errorMessage.includes('Telegram') && (
                  <button
                    onClick={() => {
                      setFormData(prev => ({ ...prev, contactType: 'email' }));
                      setShowErrorPopup(false);
                      emailRef.current?.focus();
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-semibold transition-all duration-200"
                  >
                    Switch to Email
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <section className="py-12 bg-black border-t border-slate-900 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center text-slate-500 text-sm">
            <p>Copyright © 2025 Hary Pictures</p>
            <div className="flex gap-6 mt-4 sm:mt-0">
              <a 
                href="https://www.instagram.com/hary_picture7" 
                className="hover:text-white transition-colors duration-300" 
                target="_blank" 
                rel="noopener noreferrer"
                aria-label="Instagram"
              >
                <Instagram size={18} />
              </a>
              <a 
                href="https://t.me/harygraphic" 
                className="hover:text-white transition-colors duration-300" 
                target="_blank" 
                rel="noopener noreferrer"
                aria-label="Telegram"
              >
                <TelegramIcon size={18} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Contact;