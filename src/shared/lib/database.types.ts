export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_interactions: {
        Row: {
          cache_read_tokens: number
          company_id: string
          correlation_id: string | null
          created_at: string
          created_by: string | null
          feature: string
          feedback: number | null
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string | null
          organization_id: string
          output_tokens: number
          prompt_excerpt: string | null
          reply_excerpt: string | null
          status: string
        }
        Insert: {
          cache_read_tokens?: number
          company_id: string
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          feature: string
          feedback?: number | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string | null
          organization_id: string
          output_tokens?: number
          prompt_excerpt?: string | null
          reply_excerpt?: string | null
          status?: string
        }
        Update: {
          cache_read_tokens?: number
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          feature?: string
          feedback?: number | null
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string | null
          organization_id?: string
          output_tokens?: number
          prompt_excerpt?: string | null
          reply_excerpt?: string | null
          status?: string
        }
        Relationships: []
      }
      ai_quotas: {
        Row: {
          company_id: string
          created_at: string
          monthly_quota: number
          organization_id: string
          plan: string
          trial_quota: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          monthly_quota?: number
          organization_id: string
          plan?: string
          trial_quota?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          monthly_quota?: number
          organization_id?: string
          plan?: string
          trial_quota?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          cache_read_tokens: number
          company_id: string
          created_at: string
          input_tokens: number
          organization_id: string
          output_tokens: number
          period: string
          updated_at: string
          used: number
        }
        Insert: {
          cache_read_tokens?: number
          company_id: string
          created_at?: string
          input_tokens?: number
          organization_id: string
          output_tokens?: number
          period: string
          updated_at?: string
          used?: number
        }
        Update: {
          cache_read_tokens?: number
          company_id?: string
          created_at?: string
          input_tokens?: number
          organization_id?: string
          output_tokens?: number
          period?: string
          updated_at?: string
          used?: number
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          cart_id: string | null
          channel_id: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          currency: string | null
          event_key: string | null
          event_type: Database["public"]["Enums"]["analytics_event_type"]
          id: string
          occurred_at: string
          order_id: string | null
          organization_id: string
          product_id: string | null
          promotion_id: string | null
          props: Json
          quantity: number | null
          result_count: number | null
          search_term: string | null
          session_hash: string | null
          source: Database["public"]["Enums"]["analytics_source"]
          store_id: string
          value: number | null
          variant_id: string | null
        }
        Insert: {
          cart_id?: string | null
          channel_id?: string | null
          company_id: string
          correlation_id?: string | null
          created_at?: string
          currency?: string | null
          event_key?: string | null
          event_type: Database["public"]["Enums"]["analytics_event_type"]
          id?: string
          occurred_at?: string
          order_id?: string | null
          organization_id: string
          product_id?: string | null
          promotion_id?: string | null
          props?: Json
          quantity?: number | null
          result_count?: number | null
          search_term?: string | null
          session_hash?: string | null
          source: Database["public"]["Enums"]["analytics_source"]
          store_id: string
          value?: number | null
          variant_id?: string | null
        }
        Update: {
          cart_id?: string | null
          channel_id?: string | null
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string | null
          event_key?: string | null
          event_type?: Database["public"]["Enums"]["analytics_event_type"]
          id?: string
          occurred_at?: string
          order_id?: string | null
          organization_id?: string
          product_id?: string | null
          promotion_id?: string | null
          props?: Json
          quantity?: number | null
          result_count?: number | null
          search_term?: string | null
          session_hash?: string | null
          source?: Database["public"]["Enums"]["analytics_source"]
          store_id?: string
          value?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "analytics_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      api_access_tokens: {
        Row: {
          api_client_id: string
          company_id: string
          created_at: string
          expires_at: string
          id: string
          issued_at: string
          organization_id: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
        }
        Insert: {
          api_client_id: string
          company_id: string
          created_at?: string
          expires_at: string
          id?: string
          issued_at?: string
          organization_id: string
          revoked_at?: string | null
          scopes: string[]
          token_hash: string
        }
        Update: {
          api_client_id?: string
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_at?: string
          organization_id?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_access_tokens_client_fk"
            columns: ["api_client_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      api_clients: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          organization_id: string
          rate_limit_per_minute: number
          scopes: string[]
          secret_hash: string
          secret_hint: string
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name: string
          organization_id: string
          rate_limit_per_minute?: number
          scopes?: string[]
          secret_hash: string
          secret_hint: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          organization_id?: string
          rate_limit_per_minute?: number
          scopes?: string[]
          secret_hash?: string
          secret_hint?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_idempotency: {
        Row: {
          api_client_id: string
          company_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response: Json | null
          status: number | null
        }
        Insert: {
          api_client_id: string
          company_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response?: Json | null
          status?: number | null
        }
        Update: {
          api_client_id?: string
          company_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          response?: Json | null
          status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_idempotency_client_fk"
            columns: ["api_client_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      api_requests: {
        Row: {
          api_client_id: string
          company_id: string
          correlation_id: string | null
          created_at: string
          id: string
          method: string
          organization_id: string
          route: string
          status: number | null
        }
        Insert: {
          api_client_id: string
          company_id: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          method: string
          organization_id: string
          route: string
          status?: number | null
        }
        Update: {
          api_client_id?: string
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          method?: string
          organization_id?: string
          route?: string
          status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "api_requests_client_fk"
            columns: ["api_client_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      app_capabilities: {
        Row: {
          boundary: string
          code: string
          created_at: string
          entitlement_code: string | null
          is_baseline: boolean
          state: string
        }
        Insert: {
          boundary: string
          code: string
          created_at?: string
          entitlement_code?: string | null
          is_baseline?: boolean
          state?: string
        }
        Update: {
          boundary?: string
          code?: string
          created_at?: string
          entitlement_code?: string | null
          is_baseline?: boolean
          state?: string
        }
        Relationships: []
      }
      approval_rules: {
        Row: {
          approver_role: Database["public"]["Enums"]["business_role"]
          business_account_id: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          min_amount: number
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          approver_role?: Database["public"]["Enums"]["business_role"]
          business_account_id: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_amount?: number
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          approver_role?: Database["public"]["Enums"]["business_role"]
          business_account_id?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_amount?: number
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      ar_applications: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          document_id: string
          id: string
          organization_id: string
          receipt_id: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          document_id: string
          id?: string
          organization_id: string
          receipt_id: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          document_id?: string
          id?: string
          organization_id?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_applications_document_fk"
            columns: ["document_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "ar_documents"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "ar_applications_receipt_fk"
            columns: ["receipt_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "ar_receipts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      ar_documents: {
        Row: {
          amount: number
          balance: number
          business_account_id: string | null
          company_id: string
          created_at: string
          currency: string
          customer_id: string
          document_number: string
          due_at: string
          id: string
          issued_at: string
          kind: Database["public"]["Enums"]["ar_document_kind"]
          order_id: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          balance: number
          business_account_id?: string | null
          company_id: string
          created_at?: string
          currency: string
          customer_id: string
          document_number: string
          due_at: string
          id?: string
          issued_at?: string
          kind?: Database["public"]["Enums"]["ar_document_kind"]
          order_id?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          balance?: number
          business_account_id?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          customer_id?: string
          document_number?: string
          due_at?: string
          id?: string
          issued_at?: string
          kind?: Database["public"]["Enums"]["ar_document_kind"]
          order_id?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_documents_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "ar_documents_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      ar_receipts: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          currency: string
          customer_id: string
          id: string
          method: string | null
          notes: string | null
          organization_id: string
          receipt_number: string
          received_at: string
          reference: string | null
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          currency: string
          customer_id: string
          id?: string
          method?: string | null
          notes?: string | null
          organization_id: string
          receipt_number: string
          received_at?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          method?: string | null
          notes?: string | null
          organization_id?: string
          receipt_number?: string
          received_at?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_receipts_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      assortment_assignments: {
        Row: {
          assortment_id: string
          channel_id: string | null
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          is_active: boolean
          organization_id: string
          priority: number
          scope: Database["public"]["Enums"]["assortment_scope"]
          segment_id: string | null
          store_id: string
          territory_id: string | null
          updated_at: string
        }
        Insert: {
          assortment_id: string
          channel_id?: string | null
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          priority?: number
          scope: Database["public"]["Enums"]["assortment_scope"]
          segment_id?: string | null
          store_id: string
          territory_id?: string | null
          updated_at?: string
        }
        Update: {
          assortment_id?: string
          channel_id?: string | null
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          priority?: number
          scope?: Database["public"]["Enums"]["assortment_scope"]
          segment_id?: string | null
          store_id?: string
          territory_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assortment_assignments_assortment_fk"
            columns: ["assortment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "assortments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "assortment_assignments_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "assortment_assignments_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "assortment_assignments_segment_fk"
            columns: ["segment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "assortment_assignments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "assortment_assignments_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      assortment_items: {
        Row: {
          assortment_id: string
          company_id: string
          created_at: string
          id: string
          organization_id: string
          product_id: string
          variant_id: string | null
        }
        Insert: {
          assortment_id: string
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          variant_id?: string | null
        }
        Update: {
          assortment_id?: string
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assortment_items_assortment_fk"
            columns: ["assortment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "assortments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "assortment_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assortment_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assortment_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "assortment_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "assortment_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      assortments: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_allow_list: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_allow_list?: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_allow_list?: boolean
          name?: string
          organization_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assortments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      attribute_values: {
        Row: {
          attribute_data_type: Database["public"]["Enums"]["attribute_data_type"]
          attribute_id: string
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          position: number
          updated_at: string
        }
        Insert: {
          attribute_data_type?: Database["public"]["Enums"]["attribute_data_type"]
          attribute_id: string
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          attribute_data_type?: Database["public"]["Enums"]["attribute_data_type"]
          attribute_id?: string
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribute_values_attribute_fk"
            columns: ["attribute_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "attribute_values_type_fk"
            columns: ["attribute_id", "attribute_data_type"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id", "data_type"]
          },
        ]
      }
      attributes: {
        Row: {
          code: string
          company_id: string
          created_at: string
          data_type: Database["public"]["Enums"]["attribute_data_type"]
          id: string
          is_active: boolean
          is_filterable: boolean
          is_variant_axis: boolean
          name: string
          organization_id: string
          position: number
          unit: string | null
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          data_type?: Database["public"]["Enums"]["attribute_data_type"]
          id?: string
          is_active?: boolean
          is_filterable?: boolean
          is_variant_axis?: boolean
          name: string
          organization_id: string
          position?: number
          unit?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          data_type?: Database["public"]["Enums"]["attribute_data_type"]
          id?: string
          is_active?: boolean
          is_filterable?: boolean
          is_variant_axis?: boolean
          name?: string
          organization_id?: string
          position?: number
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_kind: Database["public"]["Enums"]["audit_actor_kind"]
          actor_role: string | null
          changes: Json
          company_id: string
          correlation_id: string | null
          created_at: string
          cross_tenant: boolean
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          request_id: string | null
          store_id: string | null
          support_reason: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_kind: Database["public"]["Enums"]["audit_actor_kind"]
          actor_role?: string | null
          changes?: Json
          company_id: string
          correlation_id?: string | null
          created_at?: string
          cross_tenant?: boolean
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          request_id?: string | null
          store_id?: string | null
          support_reason?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_kind?: Database["public"]["Enums"]["audit_actor_kind"]
          actor_role?: string | null
          changes?: Json
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          cross_tenant?: boolean
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          request_id?: string | null
          store_id?: string | null
          support_reason?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      bundle_items: {
        Row: {
          bundle_kind: Database["public"]["Enums"]["product_kind"]
          bundle_product_id: string
          company_id: string
          component_kind: Database["public"]["Enums"]["product_kind"]
          component_product_id: string
          component_variant_id: string | null
          created_at: string
          id: string
          organization_id: string
          position: number
          quantity: number
          store_id: string
          uom_id: string | null
          updated_at: string
        }
        Insert: {
          bundle_kind?: Database["public"]["Enums"]["product_kind"]
          bundle_product_id: string
          company_id: string
          component_kind?: Database["public"]["Enums"]["product_kind"]
          component_product_id: string
          component_variant_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          position?: number
          quantity: number
          store_id: string
          uom_id?: string | null
          updated_at?: string
        }
        Update: {
          bundle_kind?: Database["public"]["Enums"]["product_kind"]
          bundle_product_id?: string
          company_id?: string
          component_kind?: Database["public"]["Enums"]["product_kind"]
          component_product_id?: string
          component_variant_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          position?: number
          quantity?: number
          store_id?: string
          uom_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_fk"
            columns: ["bundle_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_bundle_fk"
            columns: ["bundle_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_bundle_fk"
            columns: ["bundle_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_bundle_kind_fk"
            columns: ["bundle_product_id", "bundle_kind"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_bundle_kind_fk"
            columns: ["bundle_product_id", "bundle_kind"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_bundle_kind_fk"
            columns: ["bundle_product_id", "bundle_kind"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_component_fk"
            columns: ["component_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_component_fk"
            columns: ["component_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_component_fk"
            columns: ["component_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_component_kind_fk"
            columns: ["component_product_id", "component_kind"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_component_kind_fk"
            columns: ["component_product_id", "component_kind"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_component_kind_fk"
            columns: ["component_product_id", "component_kind"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "kind"]
          },
          {
            foreignKeyName: "bundle_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "bundle_items_uom_fk"
            columns: ["uom_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "bundle_items_variant_fk"
            columns: ["component_variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "bundle_items_variant_fk"
            columns: ["component_variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "store_id"]
          },
        ]
      }
      business_account_users: {
        Row: {
          business_account_id: string
          company_id: string
          created_at: string
          default_location_id: string | null
          email: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["business_role"]
          spending_limit: number | null
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_account_id: string
          company_id: string
          created_at?: string
          default_location_id?: string | null
          email: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["business_role"]
          spending_limit?: number | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_account_id?: string
          company_id?: string
          created_at?: string
          default_location_id?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["business_role"]
          spending_limit?: number | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_account_users_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "business_account_users_location_fk"
            columns: ["default_location_id", "business_account_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id", "business_account_id"]
          },
        ]
      }
      business_accounts: {
        Row: {
          approval_threshold: number | null
          code: string
          company_id: string
          created_at: string
          credit_limit: number | null
          credit_status: Database["public"]["Enums"]["credit_status"]
          customer_id: string
          customer_kind: Database["public"]["Enums"]["customer_kind"]
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          payment_terms_days: number
          purchase_order_required: boolean
          requires_approval: boolean
          updated_at: string
        }
        Insert: {
          approval_threshold?: number | null
          code: string
          company_id: string
          created_at?: string
          credit_limit?: number | null
          credit_status?: Database["public"]["Enums"]["credit_status"]
          customer_id: string
          customer_kind?: Database["public"]["Enums"]["customer_kind"]
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          payment_terms_days?: number
          purchase_order_required?: boolean
          requires_approval?: boolean
          updated_at?: string
        }
        Update: {
          approval_threshold?: number | null
          code?: string
          company_id?: string
          created_at?: string
          credit_limit?: number | null
          credit_status?: Database["public"]["Enums"]["credit_status"]
          customer_id?: string
          customer_kind?: Database["public"]["Enums"]["customer_kind"]
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          payment_terms_days?: number
          purchase_order_required?: boolean
          requires_approval?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_accounts_customer_fk"
            columns: ["customer_id", "customer_kind"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "business_accounts_tenant_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      business_locations: {
        Row: {
          address_id: string | null
          business_account_id: string
          code: string
          company_id: string
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          address_id?: string | null
          business_account_id: string
          code: string
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          address_id?: string | null
          business_account_id?: string
          code?: string
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_locations_account_fk"
            columns: ["business_account_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "customer_id"]
          },
          {
            foreignKeyName: "business_locations_address_fk"
            columns: ["address_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id", "customer_id"]
          },
          {
            foreignKeyName: "business_locations_tenant_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          company_id: string
          created_at: string
          currency_snapshot: string | null
          id: string
          organization_id: string
          product_id: string
          quantity: number
          quoted_at: string | null
          store_id: string
          unit_price_snapshot: number | null
          uom_code: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          cart_id: string
          company_id: string
          created_at?: string
          currency_snapshot?: string | null
          id?: string
          organization_id: string
          product_id: string
          quantity: number
          quoted_at?: string | null
          store_id: string
          unit_price_snapshot?: number | null
          uom_code?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          cart_id?: string
          company_id?: string
          created_at?: string
          currency_snapshot?: string | null
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          quoted_at?: string | null
          store_id?: string
          unit_price_snapshot?: number | null
          uom_code?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_fk"
            columns: ["cart_id", "store_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "cart_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "cart_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "cart_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "cart_items_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "cart_items_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "store_id"]
          },
        ]
      }
      carts: {
        Row: {
          channel_id: string
          company_id: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          last_activity_at: string
          merged_into: string | null
          order_id: string | null
          organization_id: string
          status: Database["public"]["Enums"]["cart_status"]
          store_id: string
          token: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          channel_id: string
          company_id: string
          created_at?: string
          currency: string
          expires_at?: string
          id?: string
          last_activity_at?: string
          merged_into?: string | null
          order_id?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["cart_status"]
          store_id: string
          token?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          channel_id?: string
          company_id?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          last_activity_at?: string
          merged_into?: string | null
          order_id?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["cart_status"]
          store_id?: string
          token?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carts_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "carts_merged_into_fk"
            columns: ["merged_into", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "carts_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "carts_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_id: string | null
          position: number
          slug: string
          store_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_id?: string | null
          position?: number
          slug: string
          store_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          position?: number
          slug?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_fk"
            columns: ["parent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "categories_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      channels: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          kind: Database["public"]["Enums"]["channel_kind"]
          name: string
          organization_id: string
          requires_auth: boolean
          settings: Json
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind: Database["public"]["Enums"]["channel_kind"]
          name: string
          organization_id: string
          requires_auth?: boolean
          settings?: Json
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: Database["public"]["Enums"]["channel_kind"]
          name?: string
          organization_id?: string
          requires_auth?: boolean
          settings?: Json
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      checkout_attempts: {
        Row: {
          company_id: string
          created_at: string
          customer_email: string
          id: string
          organization_id: string
          store_id: string
          succeeded: boolean
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_email: string
          id?: string
          organization_id: string
          store_id: string
          succeeded?: boolean
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_email?: string
          id?: string
          organization_id?: string
          store_id?: string
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "checkout_attempts_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      checkout_intents: {
        Row: {
          attempts: number
          cart_id: string | null
          company_id: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          error_stage: Database["public"]["Enums"]["checkout_stage"] | null
          id: string
          idempotency_key: string
          order_id: string | null
          organization_id: string
          request_hash: string
          reservation_token: string | null
          result: Json | null
          stage: Database["public"]["Enums"]["checkout_stage"]
          status: Database["public"]["Enums"]["checkout_intent_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          cart_id?: string | null
          company_id: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          error_stage?: Database["public"]["Enums"]["checkout_stage"] | null
          id?: string
          idempotency_key: string
          order_id?: string | null
          organization_id: string
          request_hash: string
          reservation_token?: string | null
          result?: Json | null
          stage?: Database["public"]["Enums"]["checkout_stage"]
          status?: Database["public"]["Enums"]["checkout_intent_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          cart_id?: string | null
          company_id?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          error_stage?: Database["public"]["Enums"]["checkout_stage"] | null
          id?: string
          idempotency_key?: string
          order_id?: string | null
          organization_id?: string
          request_hash?: string
          reservation_token?: string | null
          result?: Json | null
          stage?: Database["public"]["Enums"]["checkout_stage"]
          status?: Database["public"]["Enums"]["checkout_intent_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_intents_cart_fk"
            columns: ["cart_id", "store_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "checkout_intents_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "checkout_intents_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          min_attainment: number | null
          name: string
          organization_id: string
          rate: number
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_attainment?: number | null
          name: string
          organization_id: string
          rate: number
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          min_attainment?: number | null
          name?: string
          organization_id?: string
          rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      commission_statements: {
        Row: {
          amount: number
          approved_at: string | null
          base_amount: number
          company_id: string
          created_at: string
          currency: string
          id: string
          organization_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          rate: number
          rule_id: string | null
          sales_rep_id: string
          status: Database["public"]["Enums"]["commission_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          base_amount?: number
          company_id: string
          created_at?: string
          currency: string
          id?: string
          organization_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          rate: number
          rule_id?: string | null
          sales_rep_id: string
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          base_amount?: number
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          organization_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          rate?: number
          rule_id?: string | null
          sales_rep_id?: string
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_statements_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "commission_statements_rule_fk"
            columns: ["rule_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      content_block_items: {
        Row: {
          block_id: string
          block_type: Database["public"]["Enums"]["content_block_type"]
          category_id: string | null
          company_id: string
          created_at: string
          href: string | null
          id: string
          item_kind: Database["public"]["Enums"]["content_item_kind"]
          media_alt: string | null
          media_url: string | null
          organization_id: string
          position: number
          product_id: string | null
          store_id: string
          variant_id: string | null
        }
        Insert: {
          block_id: string
          block_type: Database["public"]["Enums"]["content_block_type"]
          category_id?: string | null
          company_id: string
          created_at?: string
          href?: string | null
          id?: string
          item_kind: Database["public"]["Enums"]["content_item_kind"]
          media_alt?: string | null
          media_url?: string | null
          organization_id: string
          position?: number
          product_id?: string | null
          store_id: string
          variant_id?: string | null
        }
        Update: {
          block_id?: string
          block_type?: Database["public"]["Enums"]["content_block_type"]
          category_id?: string | null
          company_id?: string
          created_at?: string
          href?: string | null
          id?: string
          item_kind?: Database["public"]["Enums"]["content_item_kind"]
          media_alt?: string | null
          media_url?: string | null
          organization_id?: string
          position?: number
          product_id?: string | null
          store_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_block_items_block_fk"
            columns: ["block_id", "block_type"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id", "block_type"]
          },
          {
            foreignKeyName: "content_block_items_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_block_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_block_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_block_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "content_block_items_store_fk"
            columns: ["block_id", "store_id"]
            isOneToOne: false
            referencedRelation: "content_blocks"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_block_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "content_block_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      content_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["content_block_type"]
          body: Json | null
          category_id: string | null
          channel_id: string | null
          company_id: string
          created_at: string
          cta_href: string | null
          cta_label: string | null
          id: string
          is_active: boolean
          item_limit: number
          media_alt: string | null
          media_url: string | null
          organization_id: string
          page_id: string
          position: number
          promotion_id: string | null
          publish_from: string
          publish_to: string | null
          segment_id: string | null
          settings: Json
          store_id: string
          subtitle: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          block_type: Database["public"]["Enums"]["content_block_type"]
          body?: Json | null
          category_id?: string | null
          channel_id?: string | null
          company_id: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          is_active?: boolean
          item_limit?: number
          media_alt?: string | null
          media_url?: string | null
          organization_id: string
          page_id: string
          position?: number
          promotion_id?: string | null
          publish_from?: string
          publish_to?: string | null
          segment_id?: string | null
          settings?: Json
          store_id: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          block_type?: Database["public"]["Enums"]["content_block_type"]
          body?: Json | null
          category_id?: string | null
          channel_id?: string | null
          company_id?: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          is_active?: boolean
          item_limit?: number
          media_alt?: string | null
          media_url?: string | null
          organization_id?: string
          page_id?: string
          position?: number
          promotion_id?: string | null
          publish_from?: string
          publish_to?: string | null
          segment_id?: string | null
          settings?: Json
          store_id?: string
          subtitle?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_blocks_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_page_fk"
            columns: ["page_id", "store_id"]
            isOneToOne: false
            referencedRelation: "content_page_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_page_fk"
            columns: ["page_id", "store_id"]
            isOneToOne: false
            referencedRelation: "content_pages"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_blocks_segment_fk"
            columns: ["segment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "content_blocks_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      content_pages: {
        Row: {
          channel_id: string | null
          company_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["content_page_kind"]
          nav_position: number
          og_image_url: string | null
          organization_id: string
          priority: number
          publish_from: string
          publish_to: string | null
          seo_description: string | null
          seo_title: string | null
          show_in_nav: boolean
          slug: string
          status: Database["public"]["Enums"]["content_status"]
          store_id: string
          title: string
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["content_page_kind"]
          nav_position?: number
          og_image_url?: string | null
          organization_id: string
          priority?: number
          publish_from?: string
          publish_to?: string | null
          seo_description?: string | null
          seo_title?: string | null
          show_in_nav?: boolean
          slug: string
          status?: Database["public"]["Enums"]["content_status"]
          store_id: string
          title: string
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["content_page_kind"]
          nav_position?: number
          og_image_url?: string | null
          organization_id?: string
          priority?: number
          publish_from?: string
          publish_to?: string | null
          seo_description?: string | null
          seo_title?: string | null
          show_in_nav?: boolean
          slug?: string
          status?: Database["public"]["Enums"]["content_status"]
          store_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pages_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_pages_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          code_normalized: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          promotion_id: string
          store_id: string
          updated_at: string
          usage_count: number
          usage_limit: number | null
          usage_limit_per_customer: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          code: string
          code_normalized?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          promotion_id: string
          store_id: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          code?: string
          code_normalized?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          promotion_id?: string
          store_id?: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "coupons_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "coupons_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          minor_unit: number
          name: string
          symbol: string
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          minor_unit?: number
          name: string
          symbol: string
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          minor_unit?: number
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          city: string | null
          company_id: string
          country: string
          created_at: string
          customer_id: string
          external_ref: string | null
          id: string
          is_active: boolean
          is_billing: boolean
          is_default_billing: boolean
          is_default_shipping: boolean
          is_shipping: boolean
          label: string
          line1: string
          line2: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          recipient: string | null
          region: string | null
          updated_at: string
          verification: Database["public"]["Enums"]["address_verification"]
          verification_source: string | null
          verified_at: string | null
        }
        Insert: {
          city?: string | null
          company_id: string
          country: string
          created_at?: string
          customer_id: string
          external_ref?: string | null
          id?: string
          is_active?: boolean
          is_billing?: boolean
          is_default_billing?: boolean
          is_default_shipping?: boolean
          is_shipping?: boolean
          label: string
          line1: string
          line2?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          recipient?: string | null
          region?: string | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["address_verification"]
          verification_source?: string | null
          verified_at?: string | null
        }
        Update: {
          city?: string | null
          company_id?: string
          country?: string
          created_at?: string
          customer_id?: string
          external_ref?: string | null
          id?: string
          is_active?: boolean
          is_billing?: boolean
          is_default_billing?: boolean
          is_default_shipping?: boolean
          is_shipping?: boolean
          label?: string
          line1?: string
          line2?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          recipient?: string | null
          region?: string | null
          updated_at?: string
          verification?: Database["public"]["Enums"]["address_verification"]
          verification_source?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      customer_business_types: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_contacts: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          email: string | null
          id: string
          is_active: boolean
          is_primary: boolean
          name: string
          organization_id: string
          phone: string | null
          role_title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name: string
          organization_id: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_primary?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      customer_external_ids: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          external_id: string
          id: string
          notes: string | null
          organization_id: string
          system_code: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id: string
          external_id: string
          id?: string
          notes?: string | null
          organization_id: string
          system_code: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          external_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          system_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_external_ids_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          business_type_id: string | null
          code: string
          company_id: string
          created_at: string
          email: string | null
          geo_lat: number | null
          geo_lng: number | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["customer_kind"]
          legal_name: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          segment_id: string | null
          tax_id: string | null
          tier: Database["public"]["Enums"]["customer_tier"] | null
          updated_at: string
          visit_frequency: Database["public"]["Enums"]["visit_frequency"] | null
        }
        Insert: {
          business_type_id?: string | null
          code: string
          company_id: string
          created_at?: string
          email?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["customer_kind"]
          legal_name?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          segment_id?: string | null
          tax_id?: string | null
          tier?: Database["public"]["Enums"]["customer_tier"] | null
          updated_at?: string
          visit_frequency?:
            | Database["public"]["Enums"]["visit_frequency"]
            | null
        }
        Update: {
          business_type_id?: string | null
          code?: string
          company_id?: string
          created_at?: string
          email?: string | null
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["customer_kind"]
          legal_name?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          segment_id?: string | null
          tax_id?: string | null
          tier?: Database["public"]["Enums"]["customer_tier"] | null
          updated_at?: string
          visit_frequency?:
            | Database["public"]["Enums"]["visit_frequency"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_type_fk"
            columns: ["business_type_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_business_types"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "customers_segment_fk"
            columns: ["segment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      delivery_methods: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          instructions: string | null
          is_active: boolean
          lead_time_max_days: number
          lead_time_min_days: number
          organization_id: string
          position: number
          provider_code: string | null
          provider_kind: Database["public"]["Enums"]["integration_kind"]
          public_config: Json
          requires_window: boolean
          sourcing: Database["public"]["Enums"]["sourcing_strategy"]
          store_id: string
          strategy: Database["public"]["Enums"]["delivery_strategy"]
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          lead_time_max_days?: number
          lead_time_min_days?: number
          organization_id: string
          position?: number
          provider_code?: string | null
          provider_kind?: Database["public"]["Enums"]["integration_kind"]
          public_config?: Json
          requires_window?: boolean
          sourcing?: Database["public"]["Enums"]["sourcing_strategy"]
          store_id: string
          strategy?: Database["public"]["Enums"]["delivery_strategy"]
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          lead_time_max_days?: number
          lead_time_min_days?: number
          organization_id?: string
          position?: number
          provider_code?: string | null
          provider_kind?: Database["public"]["Enums"]["integration_kind"]
          public_config?: Json
          requires_window?: boolean
          sourcing?: Database["public"]["Enums"]["sourcing_strategy"]
          store_id?: string
          strategy?: Database["public"]["Enums"]["delivery_strategy"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_methods_provider_fk"
            columns: ["provider_code", "provider_kind"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code", "kind"]
          },
          {
            foreignKeyName: "delivery_methods_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      delivery_plan_stops: {
        Row: {
          company_id: string
          created_at: string
          eta: string | null
          fulfillment_id: string
          id: string
          organization_id: string
          plan_id: string
          sequence: number
        }
        Insert: {
          company_id: string
          created_at?: string
          eta?: string | null
          fulfillment_id: string
          id?: string
          organization_id: string
          plan_id: string
          sequence: number
        }
        Update: {
          company_id?: string
          created_at?: string
          eta?: string | null
          fulfillment_id?: string
          id?: string
          organization_id?: string
          plan_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_plan_stops_fulfillment_fk"
            columns: ["fulfillment_id"]
            isOneToOne: true
            referencedRelation: "fulfillment_overview"
            referencedColumns: ["fulfillment_id"]
          },
          {
            foreignKeyName: "delivery_plan_stops_fulfillment_fk"
            columns: ["fulfillment_id"]
            isOneToOne: true
            referencedRelation: "fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_plan_stops_plan_fk"
            columns: ["plan_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "delivery_plans"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      delivery_plans: {
        Row: {
          closed_at: string | null
          code: string
          company_id: string
          created_at: string
          dispatched_at: string | null
          driver_name: string | null
          id: string
          organization_id: string
          plan_date: string
          status: Database["public"]["Enums"]["delivery_plan_status"]
          store_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          closed_at?: string | null
          code: string
          company_id: string
          created_at?: string
          dispatched_at?: string | null
          driver_name?: string | null
          id?: string
          organization_id: string
          plan_date: string
          status?: Database["public"]["Enums"]["delivery_plan_status"]
          store_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          closed_at?: string | null
          code?: string
          company_id?: string
          created_at?: string
          dispatched_at?: string | null
          driver_name?: string | null
          id?: string
          organization_id?: string
          plan_date?: string
          status?: Database["public"]["Enums"]["delivery_plan_status"]
          store_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_plans_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "delivery_plans_vehicle_fk"
            columns: ["vehicle_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "delivery_vehicles"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      delivery_rates: {
        Row: {
          base_amount: number
          company_id: string
          created_at: string
          currency: string
          delivery_method_id: string
          free_over_subtotal: number | null
          id: string
          is_active: boolean
          max_subtotal: number | null
          max_weight: number | null
          min_subtotal: number | null
          min_weight: number | null
          organization_id: string
          per_item_amount: number
          per_weight_amount: number
          priority: number
          store_id: string
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          base_amount?: number
          company_id: string
          created_at?: string
          currency: string
          delivery_method_id: string
          free_over_subtotal?: number | null
          id?: string
          is_active?: boolean
          max_subtotal?: number | null
          max_weight?: number | null
          min_subtotal?: number | null
          min_weight?: number | null
          organization_id: string
          per_item_amount?: number
          per_weight_amount?: number
          priority?: number
          store_id: string
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          base_amount?: number
          company_id?: string
          created_at?: string
          currency?: string
          delivery_method_id?: string
          free_over_subtotal?: number | null
          id?: string
          is_active?: boolean
          max_subtotal?: number | null
          max_weight?: number | null
          min_subtotal?: number | null
          min_weight?: number | null
          organization_id?: string
          per_item_amount?: number
          per_weight_amount?: number
          priority?: number
          store_id?: string
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_rates_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "delivery_rates_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_delivery_methods"
            referencedColumns: ["delivery_method_id", "store_id"]
          },
          {
            foreignKeyName: "delivery_rates_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "delivery_rates_zone_fk"
            columns: ["zone_id", "store_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id", "store_id"]
          },
        ]
      }
      delivery_vehicles: {
        Row: {
          capacity_kg: number | null
          capacity_m3: number | null
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          organization_id: string
          plate: string | null
          updated_at: string
        }
        Insert: {
          capacity_kg?: number | null
          capacity_m3?: number | null
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          plate?: string | null
          updated_at?: string
        }
        Update: {
          capacity_kg?: number | null
          capacity_m3?: number | null
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          plate?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      delivery_windows: {
        Row: {
          capacity: number | null
          company_id: string
          created_at: string
          cutoff_minutes: number
          delivery_method_id: string
          ends_at: string
          id: string
          is_active: boolean
          organization_id: string
          pickup_point_id: string | null
          starts_at: string
          store_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          capacity?: number | null
          company_id: string
          created_at?: string
          cutoff_minutes?: number
          delivery_method_id: string
          ends_at: string
          id?: string
          is_active?: boolean
          organization_id: string
          pickup_point_id?: string | null
          starts_at: string
          store_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          capacity?: number | null
          company_id?: string
          created_at?: string
          cutoff_minutes?: number
          delivery_method_id?: string
          ends_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          pickup_point_id?: string | null
          starts_at?: string
          store_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_windows_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "delivery_windows_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_delivery_methods"
            referencedColumns: ["delivery_method_id", "store_id"]
          },
          {
            foreignKeyName: "delivery_windows_point_fk"
            columns: ["pickup_point_id", "store_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "delivery_windows_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          code: string
          company_id: string
          country: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          postal_prefixes: string[]
          priority: number
          regions: string[]
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          country: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          postal_prefixes?: string[]
          priority?: number
          regions?: string[]
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          postal_prefixes?: string[]
          priority?: number
          regions?: string[]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      demand_forecasts: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string
          forecast_quantity: number
          generated_at: string
          id: string
          model_code: string
          organization_id: string
          period_end: string
          period_start: string
          product_id: string
          store_id: string
          territory_id: string | null
          variant_id: string | null
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string
          forecast_quantity: number
          generated_at?: string
          id?: string
          model_code?: string
          organization_id: string
          period_end: string
          period_start: string
          product_id: string
          store_id: string
          territory_id?: string | null
          variant_id?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string
          forecast_quantity?: number
          generated_at?: string
          id?: string
          model_code?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          product_id?: string
          store_id?: string
          territory_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "demand_forecasts_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "demand_forecasts_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "demand_forecasts_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "demand_forecasts_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      domain_events: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          organization_id: string
          payload: Json
          processed_at: string | null
          status: Database["public"]["Enums"]["domain_event_status"]
          store_id: string | null
          updated_at: string
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id: string
          correlation_id?: string | null
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          status?: Database["public"]["Enums"]["domain_event_status"]
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          status?: Database["public"]["Enums"]["domain_event_status"]
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      fulfillment_items: {
        Row: {
          company_id: string
          created_at: string
          fulfillment_id: string
          id: string
          order_item_id: string
          organization_id: string
          quantity: number
          store_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          fulfillment_id: string
          id?: string
          order_item_id: string
          organization_id: string
          quantity: number
          store_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          fulfillment_id?: string
          id?: string
          order_item_id?: string
          organization_id?: string
          quantity?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fulfillment_items_fulfillment_fk"
            columns: ["fulfillment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_overview"
            referencedColumns: ["fulfillment_id", "store_id"]
          },
          {
            foreignKeyName: "fulfillment_items_fulfillment_fk"
            columns: ["fulfillment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "fulfillments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillment_items_order_item_fk"
            columns: ["order_item_id", "store_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillment_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      fulfillments: {
        Row: {
          address: Json
          allocated_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          company_id: string
          contact_name: string | null
          contact_phone: string | null
          correlation_id: string | null
          created_at: string
          currency: string
          delivered_at: string | null
          delivery_method_id: string | null
          id: string
          method_code: string
          method_name: string
          order_id: string
          organization_id: string
          pickup_point_id: string | null
          promised_from: string | null
          promised_to: string | null
          provider_code: string | null
          sequence: number
          shipped_at: string | null
          shipping_cost: number
          state: Database["public"]["Enums"]["fulfillment_state"]
          store_id: string
          strategy: Database["public"]["Enums"]["delivery_strategy"]
          updated_at: string
          warehouse_id: string | null
          weight: number | null
          window_date: string | null
          window_ends_at: string | null
          window_starts_at: string | null
        }
        Insert: {
          address?: Json
          allocated_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id: string
          contact_name?: string | null
          contact_phone?: string | null
          correlation_id?: string | null
          created_at?: string
          currency: string
          delivered_at?: string | null
          delivery_method_id?: string | null
          id?: string
          method_code: string
          method_name: string
          order_id: string
          organization_id: string
          pickup_point_id?: string | null
          promised_from?: string | null
          promised_to?: string | null
          provider_code?: string | null
          sequence: number
          shipped_at?: string | null
          shipping_cost?: number
          state?: Database["public"]["Enums"]["fulfillment_state"]
          store_id: string
          strategy: Database["public"]["Enums"]["delivery_strategy"]
          updated_at?: string
          warehouse_id?: string | null
          weight?: number | null
          window_date?: string | null
          window_ends_at?: string | null
          window_starts_at?: string | null
        }
        Update: {
          address?: Json
          allocated_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          correlation_id?: string | null
          created_at?: string
          currency?: string
          delivered_at?: string | null
          delivery_method_id?: string | null
          id?: string
          method_code?: string
          method_name?: string
          order_id?: string
          organization_id?: string
          pickup_point_id?: string | null
          promised_from?: string | null
          promised_to?: string | null
          provider_code?: string | null
          sequence?: number
          shipped_at?: string | null
          shipping_cost?: number
          state?: Database["public"]["Enums"]["fulfillment_state"]
          store_id?: string
          strategy?: Database["public"]["Enums"]["delivery_strategy"]
          updated_at?: string
          warehouse_id?: string | null
          weight?: number | null
          window_date?: string | null
          window_ends_at?: string | null
          window_starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fulfillments_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "delivery_methods"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_method_fk"
            columns: ["delivery_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_delivery_methods"
            referencedColumns: ["delivery_method_id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_point_fk"
            columns: ["pickup_point_id", "store_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_provider_fk"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fulfillments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "fulfillments_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      gift_card_transactions: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          amount: number
          balance_after: number
          company_id: string
          created_at: string
          gift_card_id: string
          id: string
          kind: Database["public"]["Enums"]["gift_card_movement"]
          order_id: string | null
          organization_id: string
          reference: string | null
          store_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          amount: number
          balance_after: number
          company_id: string
          created_at?: string
          gift_card_id: string
          id?: string
          kind: Database["public"]["Enums"]["gift_card_movement"]
          order_id?: string | null
          organization_id: string
          reference?: string | null
          store_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          amount?: number
          balance_after?: number
          company_id?: string
          created_at?: string
          gift_card_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["gift_card_movement"]
          order_id?: string | null
          organization_id?: string
          reference?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_card_transactions_card_fk"
            columns: ["gift_card_id", "store_id"]
            isOneToOne: false
            referencedRelation: "gift_card_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "gift_card_transactions_card_fk"
            columns: ["gift_card_id", "store_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "gift_card_transactions_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "gift_card_transactions_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          balance: number
          code: string
          code_last4: string | null
          company_id: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          initial_amount: number
          issued_to_email: string | null
          notes: string | null
          organization_id: string
          status: Database["public"]["Enums"]["gift_card_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          balance: number
          code?: string
          code_last4?: string | null
          company_id: string
          created_at?: string
          currency: string
          expires_at: string
          id?: string
          initial_amount: number
          issued_to_email?: string | null
          notes?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["gift_card_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          code?: string
          code_last4?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          initial_amount?: number
          issued_to_email?: string | null
          notes?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["gift_card_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      integration_circuit: {
        Row: {
          company_id: string
          consecutive_fail: number
          cooldown_seconds: number
          created_at: string
          id: string
          opened_at: string | null
          operation: string
          organization_id: string
          provider_code: string
          state: Database["public"]["Enums"]["circuit_state"]
          target: string
          threshold: number
          updated_at: string
        }
        Insert: {
          company_id: string
          consecutive_fail?: number
          cooldown_seconds?: number
          created_at?: string
          id?: string
          opened_at?: string | null
          operation: string
          organization_id: string
          provider_code: string
          state?: Database["public"]["Enums"]["circuit_state"]
          target?: string
          threshold?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          consecutive_fail?: number
          cooldown_seconds?: number
          created_at?: string
          id?: string
          opened_at?: string | null
          operation?: string
          organization_id?: string
          provider_code?: string
          state?: Database["public"]["Enums"]["circuit_state"]
          target?: string
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      integration_inbox: {
        Row: {
          company_id: string
          correlation_id: string | null
          created_at: string
          event_type: string
          external_id: string
          id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          provider_code: string
        }
        Insert: {
          company_id: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          external_id: string
          id?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          provider_code: string
        }
        Update: {
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          external_id?: string
          id?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          provider_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_inbox_provider_code_fkey"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      integration_messages: {
        Row: {
          attempt: number
          company_id: string
          correlation_id: string | null
          created_at: string
          error: string | null
          id: string
          latency_ms: number | null
          operation: string
          organization_id: string
          outbox_id: string | null
          provider_code: string
          status_code: number | null
          succeeded: boolean
          target: string
        }
        Insert: {
          attempt: number
          company_id: string
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          operation: string
          organization_id: string
          outbox_id?: string | null
          provider_code: string
          status_code?: number | null
          succeeded: boolean
          target?: string
        }
        Update: {
          attempt?: number
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          latency_ms?: number | null
          operation?: string
          organization_id?: string
          outbox_id?: string | null
          provider_code?: string
          status_code?: number | null
          succeeded?: boolean
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_messages_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_monitor"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "integration_messages_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          operation: string
          organization_id: string
          payload: Json
          provider_code: string
          status: Database["public"]["Enums"]["outbox_status"]
          target: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          operation: string
          organization_id: string
          payload?: Json
          provider_code: string
          status?: Database["public"]["Enums"]["outbox_status"]
          target?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          operation?: string
          organization_id?: string
          payload?: Json
          provider_code?: string
          status?: Database["public"]["Enums"]["outbox_status"]
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_provider_code_fkey"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      integration_providers: {
        Row: {
          capabilities: string[]
          code: string
          created_at: string
          is_active: boolean
          kind: Database["public"]["Enums"]["integration_kind"]
          name: string
        }
        Insert: {
          capabilities?: string[]
          code: string
          created_at?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["integration_kind"]
          name: string
        }
        Update: {
          capabilities?: string[]
          code?: string
          created_at?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["integration_kind"]
          name?: string
        }
        Relationships: []
      }
      inventory_levels: {
        Row: {
          allow_backorder: boolean
          available_qty: number | null
          company_id: string
          created_at: string
          external_ref: string | null
          id: string
          on_hand_qty: number
          organization_id: string
          product_id: string
          reorder_point: number
          reserved_qty: number
          safety_stock: number
          store_id: string
          synced_at: string
          updated_at: string
          variant_id: string | null
          warehouse_id: string
        }
        Insert: {
          allow_backorder?: boolean
          available_qty?: number | null
          company_id: string
          created_at?: string
          external_ref?: string | null
          id?: string
          on_hand_qty?: number
          organization_id: string
          product_id: string
          reorder_point?: number
          reserved_qty?: number
          safety_stock?: number
          store_id: string
          synced_at?: string
          updated_at?: string
          variant_id?: string | null
          warehouse_id: string
        }
        Update: {
          allow_backorder?: boolean
          available_qty?: number | null
          company_id?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          on_hand_qty?: number
          organization_id?: string
          product_id?: string
          reorder_point?: number
          reserved_qty?: number
          safety_stock?: number
          store_id?: string
          synced_at?: string
          updated_at?: string
          variant_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_backorder_fk"
            columns: ["warehouse_id", "allow_backorder"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "allows_backorder"]
          },
          {
            foreignKeyName: "inventory_levels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "inventory_levels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "inventory_levels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "inventory_levels_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "inventory_levels_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "inventory_levels_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
          {
            foreignKeyName: "inventory_levels_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_id: string | null
          company_id: string
          created_at: string
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["movement_kind"]
          level_id: string | null
          occurred_at: string
          on_hand_after: number
          organization_id: string
          product_id: string
          quantity: number
          reason: string | null
          reference_id: string | null
          reference_kind: string | null
          source: Database["public"]["Enums"]["inventory_source"]
          store_id: string
          variant_id: string | null
          warehouse_id: string
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          created_at?: string
          external_ref?: string | null
          id?: string
          kind: Database["public"]["Enums"]["movement_kind"]
          level_id?: string | null
          occurred_at?: string
          on_hand_after: number
          organization_id: string
          product_id: string
          quantity: number
          reason?: string | null
          reference_id?: string | null
          reference_kind?: string | null
          source?: Database["public"]["Enums"]["inventory_source"]
          store_id: string
          variant_id?: string | null
          warehouse_id: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["movement_kind"]
          level_id?: string | null
          occurred_at?: string
          on_hand_after?: number
          organization_id?: string
          product_id?: string
          quantity?: number
          reason?: string | null
          reference_id?: string | null
          reference_kind?: string | null
          source?: Database["public"]["Enums"]["inventory_source"]
          store_id?: string
          variant_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_level_fk"
            columns: ["level_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "inventory_levels"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "inventory_movements_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "inventory_movements_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      inventory_reservation_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          level_id: string
          organization_id: string
          product_id: string
          quantity: number
          reservation_id: string
          variant_id: string | null
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          level_id: string
          organization_id: string
          product_id: string
          quantity: number
          reservation_id: string
          variant_id?: string | null
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          level_id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          reservation_id?: string
          variant_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservation_items_level_fk"
            columns: ["level_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "inventory_levels"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "inventory_reservation_items_reservation_fk"
            columns: ["reservation_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "inventory_reservations"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      inventory_reservations: {
        Row: {
          committed_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          order_id: string | null
          organization_id: string
          reference_key: string
          reference_kind: string
          release_reason: string | null
          released_at: string | null
          status: Database["public"]["Enums"]["reservation_status"]
          store_id: string
          token: string
          updated_at: string
        }
        Insert: {
          committed_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          order_id?: string | null
          organization_id: string
          reference_key: string
          reference_kind?: string
          release_reason?: string | null
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          store_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          committed_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          order_id?: string | null
          organization_id?: string
          reference_key?: string
          reference_kind?: string
          release_reason?: string | null
          released_at?: string | null
          status?: Database["public"]["Enums"]["reservation_status"]
          store_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_order_fk"
            columns: ["order_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "inventory_reservations_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      invoice_events: {
        Row: {
          company_id: string
          created_at: string
          detail: string | null
          id: string
          invoice_id: string
          organization_id: string
          status: Database["public"]["Enums"]["invoice_status"]
        }
        Insert: {
          company_id: string
          created_at?: string
          detail?: string | null
          id?: string
          invoice_id: string
          organization_id: string
          status: Database["public"]["Enums"]["invoice_status"]
        }
        Update: {
          company_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          invoice_id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["invoice_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_events_invoice_fk"
            columns: ["invoice_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          company_id: string
          created_at: string
          description: string
          id: string
          invoice_id: string
          net_amount: number
          organization_id: string
          position: number
          quantity: number
          tax_amount: number
          tax_rate: number
          unit_price: number
        }
        Insert: {
          company_id: string
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          net_amount: number
          organization_id: string
          position?: number
          quantity: number
          tax_amount: number
          tax_rate: number
          unit_price: number
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          net_amount?: number
          organization_id?: string
          position?: number
          quantity?: number
          tax_amount?: number
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_fk"
            columns: ["invoice_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      invoices: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          customer_name: string
          customer_tax_id: string | null
          document_ref: string | null
          gross_total: number
          id: string
          issued_at: string
          net_total: number
          number: string | null
          order_id: string
          organization_id: string
          provider_code: string | null
          reject_reason: string | null
          series: string
          status: Database["public"]["Enums"]["invoice_status"]
          store_id: string
          tax_total: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          customer_name: string
          customer_tax_id?: string | null
          document_ref?: string | null
          gross_total: number
          id?: string
          issued_at?: string
          net_total: number
          number?: string | null
          order_id: string
          organization_id: string
          provider_code?: string | null
          reject_reason?: string | null
          series: string
          status?: Database["public"]["Enums"]["invoice_status"]
          store_id: string
          tax_total: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          customer_name?: string
          customer_tax_id?: string | null
          document_ref?: string | null
          gross_total?: number
          id?: string
          issued_at?: string
          net_total?: number
          number?: string | null
          order_id?: string
          organization_id?: string
          provider_code?: string | null
          reject_reason?: string | null
          series?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          store_id?: string
          tax_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_order_fk"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      notification_emails: {
        Row: {
          attempts: number
          claimed_at: string | null
          company_id: string
          created_at: string
          dedupe_key: string
          expires_at: string
          id: string
          kind: string
          last_error: string | null
          locale: string
          max_attempts: number
          next_attempt_at: string
          organization_id: string
          params: Json
          provider_reference: string | null
          sent_at: string | null
          status: string
          store_id: string | null
          to_address: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          company_id: string
          created_at?: string
          dedupe_key: string
          expires_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locale?: string
          max_attempts?: number
          next_attempt_at?: string
          organization_id: string
          params?: Json
          provider_reference?: string | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          to_address: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          company_id?: string
          created_at?: string
          dedupe_key?: string
          expires_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locale?: string
          max_attempts?: number
          next_attempt_at?: string
          organization_id?: string
          params?: Json
          provider_reference?: string | null
          sent_at?: string | null
          status?: string
          store_id?: string | null
          to_address?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_emails_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      notifications: {
        Row: {
          archived_at: string | null
          audience: string
          company_id: string
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          link: string | null
          organization_id: string
          params: Json
          read_at: string | null
          recipient_user_id: string
          source_event_id: string | null
          store_id: string | null
        }
        Insert: {
          archived_at?: string | null
          audience: string
          company_id: string
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          link?: string | null
          organization_id: string
          params?: Json
          read_at?: string | null
          recipient_user_id: string
          source_event_id?: string | null
          store_id?: string | null
        }
        Update: {
          archived_at?: string | null
          audience?: string
          company_id?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          link?: string | null
          organization_id?: string
          params?: Json
          read_at?: string | null
          recipient_user_id?: string
          source_event_id?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      ops_events: {
        Row: {
          code: string
          company_id: string
          context: Json
          correlation_id: string | null
          created_at: string
          dedupe_key: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          id: string
          kind: Database["public"]["Enums"]["ops_event_kind"]
          message: string | null
          occurred_at: string
          operation: string | null
          organization_id: string
          request_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["ops_severity"]
          source: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          context?: Json
          correlation_id?: string | null
          created_at?: string
          dedupe_key: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind: Database["public"]["Enums"]["ops_event_kind"]
          message?: string | null
          occurred_at?: string
          operation?: string | null
          organization_id: string
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["ops_severity"]
          source?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          context?: Json
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["ops_event_kind"]
          message?: string | null
          occurred_at?: string
          operation?: string | null
          organization_id?: string
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["ops_severity"]
          source?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          axis: Database["public"]["Enums"]["order_event_axis"] | null
          company_id: string
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          note: string | null
          order_id: string
          organization_id: string
          payload: Json
          source: Database["public"]["Enums"]["order_event_source"]
          store_id: string
          to_value: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          axis?: Database["public"]["Enums"]["order_event_axis"] | null
          company_id: string
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          note?: string | null
          order_id: string
          organization_id: string
          payload?: Json
          source?: Database["public"]["Enums"]["order_event_source"]
          store_id: string
          to_value?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          axis?: Database["public"]["Enums"]["order_event_axis"] | null
          company_id?: string
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          note?: string | null
          order_id?: string
          organization_id?: string
          payload?: Json
          source?: Database["public"]["Enums"]["order_event_source"]
          store_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_external_refs: {
        Row: {
          company_id: string
          created_at: string
          external_id: string
          external_url: string | null
          id: string
          notes: string | null
          order_id: string
          organization_id: string
          ref_type: string
          store_id: string
          system_code: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          external_id: string
          external_url?: string | null
          id?: string
          notes?: string | null
          order_id: string
          organization_id: string
          ref_type?: string
          store_id: string
          system_code: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          external_id?: string
          external_url?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          organization_id?: string
          ref_type?: string
          store_id?: string
          system_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_external_refs_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_external_refs_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_items: {
        Row: {
          amount_after_discount: number | null
          base_quantity: number | null
          company_id: string
          components_snapshot: Json
          created_at: string
          discount_amount: number
          discount_snapshot: Json
          id: string
          line_total: number | null
          name: string
          order_id: string
          organization_id: string
          price_list_code: string | null
          price_list_id: string | null
          price_source: string
          product_id: string | null
          quantity: number
          sku: string
          store_id: string
          tax_amount: number | null
          tax_category_code: string | null
          tax_inclusive: boolean | null
          tax_rate: number | null
          unit_price: number
          uom_code: string | null
          uom_factor: number
          variant_attributes: Json
          variant_id: string | null
          variant_label: string | null
        }
        Insert: {
          amount_after_discount?: number | null
          base_quantity?: number | null
          company_id: string
          components_snapshot?: Json
          created_at?: string
          discount_amount?: number
          discount_snapshot?: Json
          id?: string
          line_total?: number | null
          name: string
          order_id: string
          organization_id: string
          price_list_code?: string | null
          price_list_id?: string | null
          price_source?: string
          product_id?: string | null
          quantity: number
          sku: string
          store_id: string
          tax_amount?: number | null
          tax_category_code?: string | null
          tax_inclusive?: boolean | null
          tax_rate?: number | null
          unit_price: number
          uom_code?: string | null
          uom_factor?: number
          variant_attributes?: Json
          variant_id?: string | null
          variant_label?: string | null
        }
        Update: {
          amount_after_discount?: number | null
          base_quantity?: number | null
          company_id?: string
          components_snapshot?: Json
          created_at?: string
          discount_amount?: number
          discount_snapshot?: Json
          id?: string
          line_total?: number | null
          name?: string
          order_id?: string
          organization_id?: string
          price_list_code?: string | null
          price_list_id?: string | null
          price_source?: string
          product_id?: string | null
          quantity?: number
          sku?: string
          store_id?: string
          tax_amount?: number | null
          tax_category_code?: string | null
          tax_inclusive?: boolean | null
          tax_rate?: number | null
          unit_price?: number
          uom_code?: string | null
          uom_factor?: number
          variant_attributes?: Json
          variant_id?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_items_price_list_fk"
            columns: ["price_list_id", "store_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "order_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_items_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_items_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "store_id"]
          },
        ]
      }
      order_notes: {
        Row: {
          author_email: string | null
          author_id: string | null
          body: string
          company_id: string
          created_at: string
          id: string
          order_id: string
          organization_id: string
          store_id: string
        }
        Insert: {
          author_email?: string | null
          author_id?: string | null
          body: string
          company_id: string
          created_at?: string
          id?: string
          order_id: string
          organization_id: string
          store_id: string
        }
        Update: {
          author_email?: string | null
          author_id?: string | null
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          order_id?: string
          organization_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_notes_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_schedules: {
        Row: {
          company_id: string
          created_at: string
          ends_on: string | null
          id: string
          interval_days: number
          last_run_at: string | null
          next_run_on: string
          organization_id: string
          status: Database["public"]["Enums"]["order_schedule_status"]
          store_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          ends_on?: string | null
          id?: string
          interval_days: number
          last_run_at?: string | null
          next_run_on: string
          organization_id: string
          status?: Database["public"]["Enums"]["order_schedule_status"]
          store_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          ends_on?: string | null
          id?: string
          interval_days?: number
          last_run_at?: string | null
          next_run_on?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["order_schedule_status"]
          store_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_schedules_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_schedules_template_fk"
            columns: ["template_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "order_templates"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          company_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          note: string | null
          order_id: string
          organization_id: string
          store_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          company_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id: string
          organization_id: string
          store_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          company_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id?: string
          organization_id?: string
          store_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_status_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_suggestion_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          last_period_quantity: number | null
          on_hand_quantity: number | null
          organization_id: string
          position: number
          product_id: string
          reason: string
          suggested_quantity: number
          suggestion_id: string
          uom_code: string | null
          variant_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          last_period_quantity?: number | null
          on_hand_quantity?: number | null
          organization_id: string
          position?: number
          product_id: string
          reason: string
          suggested_quantity: number
          suggestion_id: string
          uom_code?: string | null
          variant_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          last_period_quantity?: number | null
          on_hand_quantity?: number | null
          organization_id?: string
          position?: number
          product_id?: string
          reason?: string
          suggested_quantity?: number
          suggestion_id?: string
          uom_code?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_suggestion_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_suggestion_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_suggestion_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_suggestion_items_suggestion_fk"
            columns: ["suggestion_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "order_suggestions"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_suggestion_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "order_suggestion_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      order_suggestions: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          generated_at: string
          id: string
          model_code: string
          order_id: string | null
          organization_id: string
          sales_rep_id: string | null
          status: Database["public"]["Enums"]["suggestion_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id: string
          generated_at?: string
          id?: string
          model_code?: string
          order_id?: string | null
          organization_id: string
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          generated_at?: string
          id?: string
          model_code?: string
          order_id?: string | null
          organization_id?: string
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_suggestions_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_suggestions_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_suggestions_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_tags: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          organization_id: string
          store_id: string
          tag: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          organization_id: string
          store_id: string
          tag: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          organization_id?: string
          store_id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tags_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "order_tags_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_template_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          position: number
          product_id: string
          quantity: number
          template_id: string
          uom_code: string | null
          variant_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          position?: number
          product_id: string
          quantity: number
          template_id: string
          uom_code?: string | null
          variant_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          position?: number
          product_id?: string
          quantity?: number
          template_id?: string
          uom_code?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_template_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_template_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_template_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_template_items_template_fk"
            columns: ["template_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "order_templates"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_template_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "order_template_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      order_templates: {
        Row: {
          business_account_id: string | null
          code: string
          company_id: string
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          business_account_id?: string | null
          code: string
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          business_account_id?: string | null
          code?: string
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_templates_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_templates_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "order_templates_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      order_tokens: {
        Row: {
          company_id: string
          created_at: string
          order_id: string
          organization_id: string
          token: string
        }
        Insert: {
          company_id: string
          created_at?: string
          order_id: string
          organization_id: string
          token?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          order_id?: string
          organization_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tokens_order_fk"
            columns: ["order_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      orders: {
        Row: {
          approval_decided_at: string | null
          approval_decided_by: string | null
          approval_decided_email: string | null
          approval_reason: string | null
          approval_status: Database["public"]["Enums"]["order_approval_status"]
          billing_address: Json
          business_account_id: string | null
          cancelled_at: string | null
          channel_id: string
          company_id: string
          correlation_id: string | null
          created_at: string
          currency: string
          customer_email: string
          customer_name: string | null
          customer_phone: string | null
          customer_snapshot: Json
          discount_total: number
          fulfilled_at: string | null
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          grand_total: number
          id: string
          notes: string | null
          order_number: string
          organization_id: string
          paid_at: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          placed_at: string
          shipping_address: Json
          shipping_address_snapshot: Json
          shipping_total: number
          source_channel: Database["public"]["Enums"]["order_source_channel"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal: number
          tax_inclusive: boolean
          tax_total: number
          updated_at: string
        }
        Insert: {
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_decided_email?: string | null
          approval_reason?: string | null
          approval_status?: Database["public"]["Enums"]["order_approval_status"]
          billing_address?: Json
          business_account_id?: string | null
          cancelled_at?: string | null
          channel_id: string
          company_id: string
          correlation_id?: string | null
          created_at?: string
          currency: string
          customer_email: string
          customer_name?: string | null
          customer_phone?: string | null
          customer_snapshot?: Json
          discount_total?: number
          fulfilled_at?: string | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          grand_total?: number
          id?: string
          notes?: string | null
          order_number: string
          organization_id: string
          paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string
          shipping_address?: Json
          shipping_address_snapshot?: Json
          shipping_total?: number
          source_channel?: Database["public"]["Enums"]["order_source_channel"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal?: number
          tax_inclusive?: boolean
          tax_total?: number
          updated_at?: string
        }
        Update: {
          approval_decided_at?: string | null
          approval_decided_by?: string | null
          approval_decided_email?: string | null
          approval_reason?: string | null
          approval_status?: Database["public"]["Enums"]["order_approval_status"]
          billing_address?: Json
          business_account_id?: string | null
          cancelled_at?: string | null
          channel_id?: string
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          customer_name?: string | null
          customer_phone?: string | null
          customer_snapshot?: Json
          discount_total?: number
          fulfilled_at?: string | null
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          grand_total?: number
          id?: string
          notes?: string | null
          order_number?: string
          organization_id?: string
          paid_at?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          placed_at?: string
          shipping_address?: Json
          shipping_address_snapshot?: Json
          shipping_total?: number
          source_channel?: Database["public"]["Enums"]["order_source_channel"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          subtotal?: number
          tax_inclusive?: boolean
          tax_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "orders_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "orders_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          attempt_no: number
          company_id: string
          created_at: string
          error_code: string | null
          error_detail: string | null
          id: string
          idempotency_key: string
          latency_ms: number | null
          operation: string
          organization_id: string
          payment_intent_id: string
          provider_code: string | null
          provider_reference: string | null
          provider_result_code: string | null
          status: Database["public"]["Enums"]["payment_attempt_status"]
          store_id: string
        }
        Insert: {
          attempt_no: number
          company_id: string
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key: string
          latency_ms?: number | null
          operation: string
          organization_id: string
          payment_intent_id: string
          provider_code?: string | null
          provider_reference?: string | null
          provider_result_code?: string | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          store_id: string
        }
        Update: {
          attempt_no?: number
          company_id?: string
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key?: string
          latency_ms?: number | null
          operation?: string
          organization_id?: string
          payment_intent_id?: string
          provider_code?: string | null
          provider_reference?: string | null
          provider_result_code?: string | null
          status?: Database["public"]["Enums"]["payment_attempt_status"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intent_overview"
            referencedColumns: ["intent_id", "store_id"]
          },
          {
            foreignKeyName: "payment_attempts_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_attempts_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      payment_events: {
        Row: {
          company_id: string
          correlation_id: string | null
          created_at: string
          event_type: string
          external_event_id: string | null
          id: string
          note: string | null
          organization_id: string
          payload: Json
          payment_id: string | null
          payment_intent_id: string | null
          provider_code: string | null
          refund_id: string | null
          signature_verified: boolean
          source: Database["public"]["Enums"]["payment_event_source"]
          store_id: string
        }
        Insert: {
          company_id: string
          correlation_id?: string | null
          created_at?: string
          event_type: string
          external_event_id?: string | null
          id?: string
          note?: string | null
          organization_id: string
          payload?: Json
          payment_id?: string | null
          payment_intent_id?: string | null
          provider_code?: string | null
          refund_id?: string | null
          signature_verified?: boolean
          source: Database["public"]["Enums"]["payment_event_source"]
          store_id: string
        }
        Update: {
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          external_event_id?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          payload?: Json
          payment_id?: string | null
          payment_intent_id?: string | null
          provider_code?: string | null
          refund_id?: string | null
          signature_verified?: boolean
          source?: Database["public"]["Enums"]["payment_event_source"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intent_overview"
            referencedColumns: ["intent_id", "store_id"]
          },
          {
            foreignKeyName: "payment_events_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_events_payment_fk"
            columns: ["payment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_events_refund_fk"
            columns: ["refund_id", "store_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          amount_authorized: number
          amount_captured: number
          amount_refunded: number
          authorized_at: string | null
          cancelled_at: string | null
          capture_mode: Database["public"]["Enums"]["payment_capture_mode"]
          captured_at: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_detail: string | null
          order_id: string | null
          organization_id: string
          payment_method_id: string
          provider_code: string | null
          provider_reference: string | null
          provider_token_ref: string | null
          status: Database["public"]["Enums"]["payment_intent_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_authorized?: number
          amount_captured?: number
          amount_refunded?: number
          authorized_at?: string | null
          cancelled_at?: string | null
          capture_mode?: Database["public"]["Enums"]["payment_capture_mode"]
          captured_at?: string | null
          company_id: string
          correlation_id?: string | null
          created_at?: string
          currency: string
          expires_at?: string | null
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_detail?: string | null
          order_id?: string | null
          organization_id: string
          payment_method_id: string
          provider_code?: string | null
          provider_reference?: string | null
          provider_token_ref?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_authorized?: number
          amount_captured?: number
          amount_refunded?: number
          authorized_at?: string | null
          cancelled_at?: string | null
          capture_mode?: Database["public"]["Enums"]["payment_capture_mode"]
          captured_at?: string | null
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_detail?: string | null
          order_id?: string | null
          organization_id?: string
          payment_method_id?: string
          provider_code?: string | null
          provider_reference?: string | null
          provider_token_ref?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_method_fk"
            columns: ["payment_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_intents_method_fk"
            columns: ["payment_method_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_payment_methods"
            referencedColumns: ["payment_method_id", "store_id"]
          },
          {
            foreignKeyName: "payment_intents_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_intents_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          capture_mode: Database["public"]["Enums"]["payment_capture_mode"]
          code: string
          company_id: string
          created_at: string
          display_name: string
          id: string
          instructions: string | null
          is_active: boolean
          kind: Database["public"]["Enums"]["payment_method_kind"]
          organization_id: string
          position: number
          provider_code: string | null
          provider_kind: Database["public"]["Enums"]["integration_kind"]
          public_config: Json
          store_id: string
          updated_at: string
        }
        Insert: {
          capture_mode?: Database["public"]["Enums"]["payment_capture_mode"]
          code: string
          company_id: string
          created_at?: string
          display_name: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["payment_method_kind"]
          organization_id: string
          position?: number
          provider_code?: string | null
          provider_kind?: Database["public"]["Enums"]["integration_kind"]
          public_config?: Json
          store_id: string
          updated_at?: string
        }
        Update: {
          capture_mode?: Database["public"]["Enums"]["payment_capture_mode"]
          code?: string
          company_id?: string
          created_at?: string
          display_name?: string
          id?: string
          instructions?: string | null
          is_active?: boolean
          kind?: Database["public"]["Enums"]["payment_method_kind"]
          organization_id?: string
          position?: number
          provider_code?: string | null
          provider_kind?: Database["public"]["Enums"]["integration_kind"]
          public_config?: Json
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_provider_fk"
            columns: ["provider_code", "provider_kind"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code", "kind"]
          },
          {
            foreignKeyName: "payment_methods_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          amount_refunded: number
          captured_at: string
          company_id: string
          created_at: string
          currency: string
          id: string
          order_id: string | null
          organization_id: string
          payment_intent_id: string
          provider_code: string | null
          provider_reference: string | null
          settled_at: string | null
          settlement_reference: string | null
          status: Database["public"]["Enums"]["payment_record_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          amount_refunded?: number
          captured_at?: string
          company_id: string
          created_at?: string
          currency: string
          id?: string
          order_id?: string | null
          organization_id: string
          payment_intent_id: string
          provider_code?: string | null
          provider_reference?: string | null
          settled_at?: string | null
          settlement_reference?: string | null
          status?: Database["public"]["Enums"]["payment_record_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_refunded?: number
          captured_at?: string
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          order_id?: string | null
          organization_id?: string
          payment_intent_id?: string
          provider_code?: string | null
          provider_reference?: string | null
          settled_at?: string | null
          settlement_reference?: string | null
          status?: Database["public"]["Enums"]["payment_record_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intent_overview"
            referencedColumns: ["intent_id", "store_id"]
          },
          {
            foreignKeyName: "payments_intent_fk"
            columns: ["payment_intent_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payments_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      pickup_points: {
        Row: {
          address: Json
          code: string
          company_id: string
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          opening_hours: Json
          organization_id: string
          position: number
          store_id: string
          updated_at: string
          warehouse_id: string | null
          zone_id: string | null
        }
        Insert: {
          address?: Json
          code: string
          company_id: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          opening_hours?: Json
          organization_id: string
          position?: number
          store_id: string
          updated_at?: string
          warehouse_id?: string | null
          zone_id?: string | null
        }
        Update: {
          address?: Json
          code?: string
          company_id?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          opening_hours?: Json
          organization_id?: string
          position?: number
          store_id?: string
          updated_at?: string
          warehouse_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_points_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "pickup_points_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "pickup_points_zone_fk"
            columns: ["zone_id", "store_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id", "store_id"]
          },
        ]
      }
      pod_evidence: {
        Row: {
          caption: string | null
          company_id: string
          content_type: string | null
          created_at: string
          id: string
          organization_id: string
          pod_id: string
          storage_path: string
        }
        Insert: {
          caption?: string | null
          company_id: string
          content_type?: string | null
          created_at?: string
          id?: string
          organization_id: string
          pod_id: string
          storage_path: string
        }
        Update: {
          caption?: string | null
          company_id?: string
          content_type?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          pod_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "pod_evidence_pod_fk"
            columns: ["pod_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "proof_of_delivery"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      price_change_events: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          company_id: string
          created_at: string
          id: string
          new_min_quantity: number | null
          new_unit_price: number | null
          occurred_at: string
          old_min_quantity: number | null
          old_unit_price: number | null
          organization_id: string
          price_list_id: string | null
          price_list_item_id: string | null
          product_id: string | null
          store_id: string
          variant_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          new_min_quantity?: number | null
          new_unit_price?: number | null
          occurred_at?: string
          old_min_quantity?: number | null
          old_unit_price?: number | null
          organization_id: string
          price_list_id?: string | null
          price_list_item_id?: string | null
          product_id?: string | null
          store_id: string
          variant_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          new_min_quantity?: number | null
          new_unit_price?: number | null
          occurred_at?: string
          old_min_quantity?: number | null
          old_unit_price?: number | null
          organization_id?: string
          price_list_id?: string | null
          price_list_item_id?: string | null
          product_id?: string | null
          store_id?: string
          variant_id?: string | null
        }
        Relationships: []
      }
      price_list_assignments: {
        Row: {
          channel_id: string | null
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          is_active: boolean
          organization_id: string
          price_list_id: string
          scope: Database["public"]["Enums"]["price_scope"]
          segment_id: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          price_list_id: string
          scope: Database["public"]["Enums"]["price_scope"]
          segment_id?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          price_list_id?: string
          scope?: Database["public"]["Enums"]["price_scope"]
          segment_id?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_assignments_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "price_list_assignments_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "price_list_assignments_list_fk"
            columns: ["price_list_id", "store_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "price_list_assignments_segment_fk"
            columns: ["segment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "price_list_assignments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      price_list_items: {
        Row: {
          company_id: string
          compare_at_price: number | null
          created_at: string
          id: string
          min_quantity: number
          organization_id: string
          price_list_id: string
          product_id: string
          store_id: string
          unit_price: number
          uom_id: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          company_id: string
          compare_at_price?: number | null
          created_at?: string
          id?: string
          min_quantity?: number
          organization_id: string
          price_list_id: string
          product_id: string
          store_id: string
          unit_price: number
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          company_id?: string
          compare_at_price?: number | null
          created_at?: string
          id?: string
          min_quantity?: number
          organization_id?: string
          price_list_id?: string
          product_id?: string
          store_id?: string
          unit_price?: number
          uom_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_list_fk"
            columns: ["price_list_id", "store_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "price_list_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "price_list_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "price_list_items_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "price_list_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "price_list_items_uom_fk"
            columns: ["product_id", "uom_id"]
            isOneToOne: false
            referencedRelation: "product_uoms"
            referencedColumns: ["product_id", "uom_id"]
          },
          {
            foreignKeyName: "price_list_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "price_list_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      price_lists: {
        Row: {
          code: string
          company_id: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          priority: number
          store_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          currency: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          priority?: number
          store_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          priority?: number
          store_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "price_lists_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      product_attribute_values: {
        Row: {
          attribute_id: string
          company_id: string
          created_at: string
          id: string
          organization_id: string
          product_id: string
          store_id: string
          updated_at: string
          value_boolean: boolean | null
          value_date: string | null
          value_id: string | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          attribute_id: string
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          store_id: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_id?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          attribute_id?: string
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          store_id?: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_id?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_values_attribute_fk"
            columns: ["attribute_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "product_attribute_values_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_attribute_values_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_attribute_values_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_attribute_values_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "product_attribute_values_value_fk"
            columns: ["value_id", "attribute_id"]
            isOneToOne: false
            referencedRelation: "attribute_values"
            referencedColumns: ["id", "attribute_id"]
          },
        ]
      }
      product_channels: {
        Row: {
          channel_id: string
          company_id: string
          created_at: string
          id: string
          organization_id: string
          product_id: string
          store_id: string
        }
        Insert: {
          channel_id: string
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          store_id: string
        }
        Update: {
          channel_id?: string
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_channels_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_channels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_channels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_channels_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
        ]
      }
      product_families: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_favorites: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          product_id: string
          store_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          store_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_favorites_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_favorites_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_favorites_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_favorites_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          company_id: string
          created_at: string
          id: string
          is_primary: boolean
          organization_id: string
          position: number
          product_id: string
          storage_path: string
          store_id: string
          updated_at: string
        }
        Insert: {
          alt?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id: string
          position?: number
          product_id: string
          storage_path: string
          store_id: string
          updated_at?: string
        }
        Update: {
          alt?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          position?: number
          product_id?: string
          storage_path?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_images_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      product_relations: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          position: number
          product_id: string
          related_product_id: string
          relation_kind: Database["public"]["Enums"]["product_relation_kind"]
          store_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          position?: number
          product_id: string
          related_product_id: string
          relation_kind?: Database["public"]["Enums"]["product_relation_kind"]
          store_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          position?: number
          product_id?: string
          related_product_id?: string
          relation_kind?: Database["public"]["Enums"]["product_relation_kind"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_relations_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_related_fk"
            columns: ["related_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_related_fk"
            columns: ["related_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_related_fk"
            columns: ["related_product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_relations_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      product_uoms: {
        Row: {
          barcode: string | null
          company_id: string
          created_at: string
          factor: number
          id: string
          is_base: boolean
          is_sellable: boolean
          organization_id: string
          position: number
          price: number | null
          product_id: string
          store_id: string
          uom_id: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          company_id: string
          created_at?: string
          factor: number
          id?: string
          is_base?: boolean
          is_sellable?: boolean
          organization_id: string
          position?: number
          price?: number | null
          product_id: string
          store_id: string
          uom_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          company_id?: string
          created_at?: string
          factor?: number
          id?: string
          is_base?: boolean
          is_sellable?: boolean
          organization_id?: string
          position?: number
          price?: number | null
          product_id?: string
          store_id?: string
          uom_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_uoms_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_uoms_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_uoms_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_uoms_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "product_uoms_uom_fk"
            columns: ["uom_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          company_id: string
          compare_at_price: number | null
          created_at: string
          custom_fields: Json
          id: string
          in_stock: boolean | null
          is_active: boolean
          is_default: boolean
          name: string
          organization_id: string
          position: number
          price: number | null
          product_id: string
          product_kind: Database["public"]["Enums"]["product_kind"]
          shipping_weight: number | null
          sku: string
          stock: number
          store_id: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          company_id: string
          compare_at_price?: number | null
          created_at?: string
          custom_fields?: Json
          id?: string
          in_stock?: boolean | null
          is_active?: boolean
          is_default?: boolean
          name: string
          organization_id: string
          position?: number
          price?: number | null
          product_id: string
          product_kind?: Database["public"]["Enums"]["product_kind"]
          shipping_weight?: number | null
          sku: string
          stock?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          company_id?: string
          compare_at_price?: number | null
          created_at?: string
          custom_fields?: Json
          id?: string
          in_stock?: boolean | null
          is_active?: boolean
          is_default?: boolean
          name?: string
          organization_id?: string
          position?: number
          price?: number | null
          product_id?: string
          product_kind?: Database["public"]["Enums"]["product_kind"]
          shipping_weight?: number | null
          sku?: string
          stock?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_kind_fk"
            columns: ["product_id", "product_kind"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "product_variants_kind_fk"
            columns: ["product_id", "product_kind"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "product_variants_kind_fk"
            columns: ["product_id", "product_kind"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "kind"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "product_variants_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category_id: string | null
          company_id: string
          compare_at_price: number | null
          created_at: string
          currency: string
          custom_fields: Json
          description: string | null
          family_id: string | null
          id: string
          in_stock: boolean | null
          kind: Database["public"]["Enums"]["product_kind"]
          name: string
          organization_id: string
          price: number
          published_at: string | null
          search_vector: unknown
          shipping_weight: number | null
          sku: string
          slug: string
          status: Database["public"]["Enums"]["product_status"]
          stock: number
          store_id: string
          tax_category_id: string | null
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          company_id: string
          compare_at_price?: number | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          description?: string | null
          family_id?: string | null
          id?: string
          in_stock?: boolean | null
          kind?: Database["public"]["Enums"]["product_kind"]
          name: string
          organization_id: string
          price: number
          published_at?: string | null
          search_vector?: unknown
          shipping_weight?: number | null
          sku: string
          slug: string
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          store_id: string
          tax_category_id?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          company_id?: string
          compare_at_price?: number | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          description?: string | null
          family_id?: string | null
          id?: string
          in_stock?: boolean | null
          kind?: Database["public"]["Enums"]["product_kind"]
          name?: string
          organization_id?: string
          price?: number
          published_at?: string | null
          search_vector?: unknown
          shipping_weight?: number | null
          sku?: string
          slug?: string
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          store_id?: string
          tax_category_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_fk"
            columns: ["brand_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "products_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_family_fk"
            columns: ["family_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "product_families"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_tax_category_fk"
            columns: ["tax_category_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "tax_categories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      promotion_audiences: {
        Row: {
          audience_kind: Database["public"]["Enums"]["promotion_audience_kind"]
          business_account_id: string | null
          channel_id: string | null
          company_id: string
          created_at: string
          customer_id: string | null
          id: string
          organization_id: string
          promotion_id: string
          segment_id: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          audience_kind: Database["public"]["Enums"]["promotion_audience_kind"]
          business_account_id?: string | null
          channel_id?: string | null
          company_id: string
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id: string
          promotion_id: string
          segment_id?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          audience_kind?: Database["public"]["Enums"]["promotion_audience_kind"]
          business_account_id?: string | null
          channel_id?: string | null
          company_id?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          organization_id?: string
          promotion_id?: string
          segment_id?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_audiences_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_audiences_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_audiences_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_audiences_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_audiences_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_audiences_segment_fk"
            columns: ["segment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_audiences_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      promotion_budgets: {
        Row: {
          budget_amount: number
          company_id: string
          consumed_amount: number
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          is_active: boolean
          organization_id: string
          period_end: string | null
          period_start: string | null
          promotion_id: string
          territory_id: string | null
          updated_at: string
        }
        Insert: {
          budget_amount: number
          company_id: string
          consumed_amount?: number
          created_at?: string
          currency: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          promotion_id: string
          territory_id?: string | null
          updated_at?: string
        }
        Update: {
          budget_amount?: number
          company_id?: string
          consumed_amount?: number
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          promotion_id?: string
          territory_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_budgets_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_budgets_promotion_fk"
            columns: ["promotion_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_budgets_promotion_fk"
            columns: ["promotion_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_budgets_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      promotion_events: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          company_id: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          occurred_at: string
          organization_id: string
          promotion_id: string | null
          promotion_status:
            | Database["public"]["Enums"]["promotion_status"]
            | null
          store_id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          company_id: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          promotion_id?: string | null
          promotion_status?:
            | Database["public"]["Enums"]["promotion_status"]
            | null
          store_id: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          company_id?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          promotion_id?: string | null
          promotion_status?:
            | Database["public"]["Enums"]["promotion_status"]
            | null
          store_id?: string
        }
        Relationships: []
      }
      promotion_redemptions: {
        Row: {
          business_account_id: string | null
          company_id: string
          coupon_id: string | null
          created_at: string
          currency: string
          customer_email: string
          customer_id: string | null
          discount_amount: number
          id: string
          order_id: string
          organization_id: string
          promotion_id: string
          redeemed_at: string
          store_id: string
        }
        Insert: {
          business_account_id?: string | null
          company_id: string
          coupon_id?: string | null
          created_at?: string
          currency: string
          customer_email: string
          customer_id?: string | null
          discount_amount: number
          id?: string
          order_id: string
          organization_id: string
          promotion_id: string
          redeemed_at?: string
          store_id: string
        }
        Update: {
          business_account_id?: string | null
          company_id?: string
          coupon_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          order_id?: string
          organization_id?: string
          promotion_id?: string
          redeemed_at?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_coupon_fk"
            columns: ["coupon_id", "store_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_redemptions_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_redemptions_promotion_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_redemptions_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      promotion_scopes: {
        Row: {
          brand_id: string | null
          category_id: string | null
          company_id: string
          created_at: string
          id: string
          include_descendants: boolean
          is_exclusion: boolean
          organization_id: string
          product_id: string | null
          promotion_id: string
          promotion_kind: Database["public"]["Enums"]["promotion_kind"]
          required_quantity: number | null
          scope_kind: Database["public"]["Enums"]["promotion_scope_kind"]
          store_id: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          include_descendants?: boolean
          is_exclusion?: boolean
          organization_id: string
          product_id?: string | null
          promotion_id: string
          promotion_kind: Database["public"]["Enums"]["promotion_kind"]
          required_quantity?: number | null
          scope_kind: Database["public"]["Enums"]["promotion_scope_kind"]
          store_id: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          include_descendants?: boolean
          is_exclusion?: boolean
          organization_id?: string
          product_id?: string | null
          promotion_id?: string
          promotion_kind?: Database["public"]["Enums"]["promotion_kind"]
          required_quantity?: number | null
          scope_kind?: Database["public"]["Enums"]["promotion_scope_kind"]
          store_id?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotion_scopes_brand_fk"
            columns: ["brand_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_scopes_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_promotion_fk"
            columns: ["promotion_id", "promotion_kind"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "promotion_scopes_promotion_fk"
            columns: ["promotion_id", "promotion_kind"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "promotion_scopes_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_scopes_store_promo_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_store_promo_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_scopes_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "promotion_scopes_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      promotion_tiers: {
        Row: {
          company_id: string
          created_at: string
          discount_amount: number | null
          discount_percent: number | null
          id: string
          min_quantity: number
          organization_id: string
          promotion_id: string
          promotion_kind: Database["public"]["Enums"]["promotion_kind"]
          store_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          min_quantity: number
          organization_id: string
          promotion_id: string
          promotion_kind: Database["public"]["Enums"]["promotion_kind"]
          store_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          discount_amount?: number | null
          discount_percent?: number | null
          id?: string
          min_quantity?: number
          organization_id?: string
          promotion_id?: string
          promotion_kind?: Database["public"]["Enums"]["promotion_kind"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_tiers_promotion_fk"
            columns: ["promotion_id", "promotion_kind"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "promotion_tiers_promotion_fk"
            columns: ["promotion_id", "promotion_kind"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "kind"]
          },
          {
            foreignKeyName: "promotion_tiers_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "promotion_tiers_store_promo_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotion_overview"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "promotion_tiers_store_promo_fk"
            columns: ["promotion_id", "store_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "store_id"]
          },
        ]
      }
      promotions: {
        Row: {
          buy_quantity: number | null
          code: string
          company_id: string
          created_at: string
          description: string | null
          free_quantity: number | null
          id: string
          image_url: string | null
          is_exclusive: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_discount_amount: number | null
          min_quantity: number | null
          min_subtotal: number | null
          name: string
          organization_id: string
          priority: number
          requires_coupon: boolean
          stack_group: string | null
          status: Database["public"]["Enums"]["promotion_status"]
          store_id: string
          updated_at: string
          usage_count: number
          usage_limit: number | null
          usage_limit_per_customer: number | null
          valid_from: string
          valid_to: string | null
          value_amount: number | null
          value_percent: number | null
        }
        Insert: {
          buy_quantity?: number | null
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          free_quantity?: number | null
          id?: string
          image_url?: string | null
          is_exclusive?: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_discount_amount?: number | null
          min_quantity?: number | null
          min_subtotal?: number | null
          name: string
          organization_id: string
          priority?: number
          requires_coupon?: boolean
          stack_group?: string | null
          status?: Database["public"]["Enums"]["promotion_status"]
          store_id: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string
          valid_to?: string | null
          value_amount?: number | null
          value_percent?: number | null
        }
        Update: {
          buy_quantity?: number | null
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          free_quantity?: number | null
          id?: string
          image_url?: string | null
          is_exclusive?: boolean
          kind?: Database["public"]["Enums"]["promotion_kind"]
          max_discount_amount?: number | null
          min_quantity?: number | null
          min_subtotal?: number | null
          name?: string
          organization_id?: string
          priority?: number
          requires_coupon?: boolean
          stack_group?: string | null
          status?: Database["public"]["Enums"]["promotion_status"]
          store_id?: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string
          valid_to?: string | null
          value_amount?: number | null
          value_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      proof_of_delivery: {
        Row: {
          company_id: string
          created_at: string
          document_id: string | null
          fulfillment_id: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          organization_id: string
          outcome: Database["public"]["Enums"]["pod_outcome"]
          reason: string | null
          received_by: string | null
          recorded_by: string | null
          stop_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          document_id?: string | null
          fulfillment_id: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          organization_id: string
          outcome: Database["public"]["Enums"]["pod_outcome"]
          reason?: string | null
          received_by?: string | null
          recorded_by?: string | null
          stop_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          document_id?: string | null
          fulfillment_id?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          organization_id?: string
          outcome?: Database["public"]["Enums"]["pod_outcome"]
          reason?: string | null
          received_by?: string | null
          recorded_by?: string | null
          stop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_of_delivery_fulfillment_fk"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_overview"
            referencedColumns: ["fulfillment_id"]
          },
          {
            foreignKeyName: "proof_of_delivery_fulfillment_fk"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "fulfillments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proof_of_delivery_stop_fk"
            columns: ["stop_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "delivery_plan_stops"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      public_rate_events: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          store_id: string
          surface: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          store_id: string
          surface: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          store_id?: string
          surface?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_rate_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      quote_items: {
        Row: {
          company_id: string
          created_at: string
          id: string
          line_total: number
          organization_id: string
          position: number
          product_id: string
          quantity: number
          quote_id: string
          tax_amount: number | null
          tax_rate: number | null
          unit_price: number
          uom_code: string | null
          variant_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          line_total: number
          organization_id: string
          position?: number
          product_id: string
          quantity: number
          quote_id: string
          tax_amount?: number | null
          tax_rate?: number | null
          unit_price: number
          uom_code?: string | null
          variant_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          line_total?: number
          organization_id?: string
          position?: number
          product_id?: string
          quantity?: number
          quote_id?: string
          tax_amount?: number | null
          tax_rate?: number | null
          unit_price?: number
          uom_code?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quote_items_quote_fk"
            columns: ["quote_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "quote_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "quote_items_variant_fk"
            columns: ["variant_id", "product_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "product_id"]
          },
        ]
      }
      quotes: {
        Row: {
          business_account_id: string | null
          company_id: string
          created_at: string
          currency: string
          customer_id: string
          grand_total: number
          id: string
          issued_at: string
          notes: string | null
          order_id: string | null
          organization_id: string
          quote_number: string
          sales_rep_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          store_id: string
          subtotal: number
          tax_total: number
          updated_at: string
          valid_until: string
        }
        Insert: {
          business_account_id?: string | null
          company_id: string
          created_at?: string
          currency: string
          customer_id: string
          grand_total?: number
          id?: string
          issued_at?: string
          notes?: string | null
          order_id?: string | null
          organization_id: string
          quote_number: string
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          store_id: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          valid_until: string
        }
        Update: {
          business_account_id?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          customer_id?: string
          grand_total?: number
          id?: string
          issued_at?: string
          notes?: string | null
          order_id?: string | null
          organization_id?: string
          quote_number?: string
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          store_id?: string
          subtotal?: number
          tax_total?: number
          updated_at?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_account_fk"
            columns: ["business_account_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "quotes_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "quotes_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "quotes_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      reconciliation_records: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          discrepancy_reason: string | null
          external_reference: string
          fee_amount: number
          gross_amount: number
          id: string
          matched_at: string | null
          net_amount: number
          organization_id: string
          payment_id: string | null
          provider_code: string
          raw: Json
          settlement_date: string
          source_batch: string | null
          status: Database["public"]["Enums"]["reconciliation_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          discrepancy_reason?: string | null
          external_reference: string
          fee_amount?: number
          gross_amount: number
          id?: string
          matched_at?: string | null
          net_amount: number
          organization_id: string
          payment_id?: string | null
          provider_code: string
          raw?: Json
          settlement_date: string
          source_batch?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          discrepancy_reason?: string | null
          external_reference?: string
          fee_amount?: number
          gross_amount?: number
          id?: string
          matched_at?: string | null
          net_amount?: number
          organization_id?: string
          payment_id?: string | null
          provider_code?: string
          raw?: Json
          settlement_date?: string
          source_batch?: string | null
          status?: Database["public"]["Enums"]["reconciliation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_provider_fk"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "reconciliation_records_payment_fk"
            columns: ["payment_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          company_id: string
          completed_at: string | null
          created_at: string
          currency: string
          error_code: string | null
          error_detail: string | null
          id: string
          idempotency_key: string
          order_id: string | null
          organization_id: string
          payment_id: string
          provider_code: string | null
          provider_reference: string | null
          reason: string | null
          requested_by: string | null
          requested_email: string | null
          status: Database["public"]["Enums"]["refund_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          completed_at?: string | null
          created_at?: string
          currency: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key: string
          order_id?: string | null
          organization_id: string
          payment_id: string
          provider_code?: string | null
          provider_reference?: string | null
          reason?: string | null
          requested_by?: string | null
          requested_email?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string | null
          organization_id?: string
          payment_id?: string
          provider_code?: string | null
          provider_reference?: string | null
          reason?: string | null
          requested_by?: string | null
          requested_email?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "refunds_payment_fk"
            columns: ["payment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "refunds_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      return_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          company_id: string
          created_at: string
          event_type: string
          from_state: Database["public"]["Enums"]["return_state"] | null
          id: string
          note: string | null
          organization_id: string
          payload: Json
          return_request_id: string
          store_id: string
          to_state: Database["public"]["Enums"]["return_state"] | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          company_id: string
          created_at?: string
          event_type: string
          from_state?: Database["public"]["Enums"]["return_state"] | null
          id?: string
          note?: string | null
          organization_id: string
          payload?: Json
          return_request_id: string
          store_id: string
          to_state?: Database["public"]["Enums"]["return_state"] | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          company_id?: string
          created_at?: string
          event_type?: string
          from_state?: Database["public"]["Enums"]["return_state"] | null
          id?: string
          note?: string | null
          organization_id?: string
          payload?: Json
          return_request_id?: string
          store_id?: string
          to_state?: Database["public"]["Enums"]["return_state"] | null
        }
        Relationships: [
          {
            foreignKeyName: "return_events_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_overview"
            referencedColumns: ["return_request_id", "store_id"]
          },
          {
            foreignKeyName: "return_events_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      return_evidence: {
        Row: {
          caption: string | null
          company_id: string
          content_type: string
          created_at: string
          id: string
          organization_id: string
          return_request_id: string
          size_bytes: number
          storage_path: string
          store_id: string
          uploaded_by: string | null
          uploaded_email: string | null
        }
        Insert: {
          caption?: string | null
          company_id: string
          content_type: string
          created_at?: string
          id?: string
          organization_id: string
          return_request_id: string
          size_bytes: number
          storage_path: string
          store_id: string
          uploaded_by?: string | null
          uploaded_email?: string | null
        }
        Update: {
          caption?: string | null
          company_id?: string
          content_type?: string
          created_at?: string
          id?: string
          organization_id?: string
          return_request_id?: string
          size_bytes?: number
          storage_path?: string
          store_id?: string
          uploaded_by?: string | null
          uploaded_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_evidence_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_overview"
            referencedColumns: ["return_request_id", "store_id"]
          },
          {
            foreignKeyName: "return_evidence_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_evidence_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      return_items: {
        Row: {
          company_id: string
          condition: Database["public"]["Enums"]["return_item_condition"]
          created_at: string
          id: string
          note: string | null
          order_item_id: string
          organization_id: string
          quantity: number
          reason_code: string
          received_quantity: number
          refund_amount: number
          restock: boolean
          restock_movement_id: string | null
          return_request_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          condition?: Database["public"]["Enums"]["return_item_condition"]
          created_at?: string
          id?: string
          note?: string | null
          order_item_id: string
          organization_id: string
          quantity: number
          reason_code: string
          received_quantity?: number
          refund_amount?: number
          restock?: boolean
          restock_movement_id?: string | null
          return_request_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          condition?: Database["public"]["Enums"]["return_item_condition"]
          created_at?: string
          id?: string
          note?: string | null
          order_item_id?: string
          organization_id?: string
          quantity?: number
          reason_code?: string
          received_quantity?: number
          refund_amount?: number
          restock?: boolean
          restock_movement_id?: string | null
          return_request_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_items_order_item_fk"
            columns: ["order_item_id", "store_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_items_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_overview"
            referencedColumns: ["return_request_id", "store_id"]
          },
          {
            foreignKeyName: "return_items_request_fk"
            columns: ["return_request_id", "store_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      return_reasons: {
        Row: {
          code: string
          company_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
          organization_id: string
          position: number
          requires_evidence: boolean
          restock_default: boolean
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          position?: number
          requires_evidence?: boolean
          restock_default?: boolean
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          position?: number
          requires_evidence?: boolean
          restock_default?: boolean
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_reasons_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      return_requests: {
        Row: {
          cancelled_at: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          currency: string
          customer_email: string
          customer_note: string | null
          decided_at: string | null
          decided_by: string | null
          decided_email: string | null
          decision_note: string | null
          id: string
          inspected_at: string | null
          order_id: string
          organization_id: string
          reason_code: string
          reason_label: string
          received_at: string | null
          refund_amount: number
          resolution: Database["public"]["Enums"]["return_resolution"]
          rma_number: string
          source: Database["public"]["Enums"]["return_source"]
          state: Database["public"]["Enums"]["return_state"]
          store_id: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          currency: string
          customer_email: string
          customer_note?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_email?: string | null
          decision_note?: string | null
          id?: string
          inspected_at?: string | null
          order_id: string
          organization_id: string
          reason_code: string
          reason_label: string
          received_at?: string | null
          refund_amount?: number
          resolution?: Database["public"]["Enums"]["return_resolution"]
          rma_number: string
          source?: Database["public"]["Enums"]["return_source"]
          state?: Database["public"]["Enums"]["return_state"]
          store_id: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          customer_note?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decided_email?: string | null
          decision_note?: string | null
          id?: string
          inspected_at?: string | null
          order_id?: string
          organization_id?: string
          reason_code?: string
          reason_label?: string
          received_at?: string | null
          refund_amount?: number
          resolution?: Database["public"]["Enums"]["return_resolution"]
          rma_number?: string
          source?: Database["public"]["Enums"]["return_source"]
          state?: Database["public"]["Enums"]["return_state"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_requests_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_requests_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_goals: {
        Row: {
          company_id: string
          created_at: string
          currency: string | null
          id: string
          metric: Database["public"]["Enums"]["goal_metric"]
          organization_id: string
          period_end: string
          period_start: string
          sales_rep_id: string | null
          target_value: number
          territory_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency?: string | null
          id?: string
          metric: Database["public"]["Enums"]["goal_metric"]
          organization_id: string
          period_end: string
          period_start: string
          sales_rep_id?: string | null
          target_value: number
          territory_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          metric?: Database["public"]["Enums"]["goal_metric"]
          organization_id?: string
          period_end?: string
          period_start?: string
          sales_rep_id?: string | null
          target_value?: number
          territory_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_goals_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_goals_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_rep_customers: {
        Row: {
          assigned_at: string
          company_id: string
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          organization_id: string
          sales_rep_id: string
        }
        Insert: {
          assigned_at?: string
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          organization_id: string
          sales_rep_id: string
        }
        Update: {
          assigned_at?: string
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          sales_rep_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_rep_customers_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_rep_customers_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_rep_territories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          sales_rep_id: string
          territory_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          sales_rep_id: string
          territory_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          sales_rep_id?: string
          territory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_rep_territories_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_rep_territories_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_reps: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          employee_code: string
          full_name: string
          hired_at: string | null
          id: string
          manager_id: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          employee_code: string
          full_name: string
          hired_at?: string | null
          id?: string
          manager_id?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          employee_code?: string
          full_name?: string
          hired_at?: string | null
          id?: string
          manager_id?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_reps_manager_fk"
            columns: ["manager_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_route_stops: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          id: string
          organization_id: string
          route_id: string
          sequence: number
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_id: string
          id?: string
          organization_id: string
          route_id: string
          sequence: number
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          organization_id?: string
          route_id?: string
          sequence?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_route_stops_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_route_stops_route_fk"
            columns: ["route_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_routes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_routes: {
        Row: {
          code: string
          company_id: string
          created_at: string
          frequency_weeks: number
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sales_rep_id: string
          territory_id: string | null
          updated_at: string
          weekday: number
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          frequency_weeks?: number
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sales_rep_id: string
          territory_id?: string | null
          updated_at?: string
          weekday: number
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          frequency_weeks?: number
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sales_rep_id?: string
          territory_id?: string | null
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_routes_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_routes_territory_fk"
            columns: ["territory_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_territories: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_territories_parent_fk"
            columns: ["parent_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_territories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_visit_tasks: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_done: boolean
          label: string
          organization_id: string
          position: number
          visit_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_done?: boolean
          label: string
          organization_id: string
          position?: number
          visit_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_done?: boolean
          label?: string
          organization_id?: string
          position?: number
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_visit_tasks_visit_fk"
            columns: ["visit_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_visits"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      sales_visits: {
        Row: {
          checked_in_at: string | null
          checked_out_at: string | null
          company_id: string
          created_at: string
          customer_id: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          notes: string | null
          order_id: string | null
          organization_id: string
          outcome: Database["public"]["Enums"]["visit_outcome"]
          planned_at: string | null
          route_id: string | null
          sales_rep_id: string
          updated_at: string
        }
        Insert: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          company_id: string
          created_at?: string
          customer_id: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          notes?: string | null
          order_id?: string | null
          organization_id: string
          outcome?: Database["public"]["Enums"]["visit_outcome"]
          planned_at?: string | null
          route_id?: string | null
          sales_rep_id: string
          updated_at?: string
        }
        Update: {
          checked_in_at?: string | null
          checked_out_at?: string | null
          company_id?: string
          created_at?: string
          customer_id?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          notes?: string | null
          order_id?: string | null
          organization_id?: string
          outcome?: Database["public"]["Enums"]["visit_outcome"]
          planned_at?: string | null
          route_id?: string | null
          sales_rep_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_visits_customer_fk"
            columns: ["customer_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_visits_rep_fk"
            columns: ["sales_rep_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "sales_visits_route_fk"
            columns: ["route_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "sales_routes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      search_synonyms: {
        Row: {
          company_id: string
          created_at: string
          expansions: string[]
          id: string
          is_active: boolean
          organization_id: string
          store_id: string
          term: string
          term_normalized: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expansions: string[]
          id?: string
          is_active?: boolean
          organization_id: string
          store_id: string
          term: string
          term_normalized?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expansions?: string[]
          id?: string
          is_active?: boolean
          organization_id?: string
          store_id?: string
          term?: string
          term_normalized?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_synonyms_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          company_id: string
          created_at: string
          fulfillment_item_id: string
          id: string
          organization_id: string
          quantity: number
          shipment_id: string
          store_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          fulfillment_item_id: string
          id?: string
          organization_id: string
          quantity: number
          shipment_id: string
          store_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          fulfillment_item_id?: string
          id?: string
          organization_id?: string
          quantity?: number
          shipment_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_line_fk"
            columns: ["fulfillment_item_id", "store_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_items"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_fk"
            columns: ["shipment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "shipment_items_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      shipments: {
        Row: {
          company_id: string
          cost: number | null
          created_at: string
          currency: string | null
          delivered_at: string | null
          estimated_delivery: string | null
          fulfillment_id: string
          id: string
          idempotency_key: string
          label_ref: string | null
          last_error_code: string | null
          last_error_detail: string | null
          organization_id: string
          provider_code: string | null
          service_code: string | null
          shipped_at: string | null
          state: Database["public"]["Enums"]["shipment_state"]
          store_id: string
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          company_id: string
          cost?: number | null
          created_at?: string
          currency?: string | null
          delivered_at?: string | null
          estimated_delivery?: string | null
          fulfillment_id: string
          id?: string
          idempotency_key: string
          label_ref?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          organization_id: string
          provider_code?: string | null
          service_code?: string | null
          shipped_at?: string | null
          state?: Database["public"]["Enums"]["shipment_state"]
          store_id: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          company_id?: string
          cost?: number | null
          created_at?: string
          currency?: string | null
          delivered_at?: string | null
          estimated_delivery?: string | null
          fulfillment_id?: string
          id?: string
          idempotency_key?: string
          label_ref?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          organization_id?: string
          provider_code?: string | null
          service_code?: string | null
          shipped_at?: string | null
          state?: Database["public"]["Enums"]["shipment_state"]
          store_id?: string
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_fulfillment_fk"
            columns: ["fulfillment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "fulfillment_overview"
            referencedColumns: ["fulfillment_id", "store_id"]
          },
          {
            foreignKeyName: "shipments_fulfillment_fk"
            columns: ["fulfillment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "fulfillments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "shipments_provider_fk"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shipments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      store_settings: {
        Row: {
          accent_color: string
          banner_url: string | null
          business_display_name: string | null
          checkout_requires_account: boolean
          company_id: string
          config: Json
          contact_address: string | null
          contact_phone: string | null
          created_at: string
          custom_domain_status: string
          custom_domain_token: string | null
          custom_domain_verified_at: string | null
          default_locale: string
          email_from_name: string | null
          email_reply_to: string | null
          favicon_url: string | null
          font_family: string | null
          hero_subtitle: string | null
          hero_title: string | null
          home_layout: Json
          logo_url: string | null
          organization_id: string
          require_payment_before_dispatch: boolean
          store_id: string
          storefront_style: Json
          support_email: string | null
          tax_category_id: string | null
          tax_inclusive: boolean
          tax_rate: number
          theme_preset: string
          ui_density: string | null
          ui_radius: string | null
          updated_at: string
          white_label: boolean
        }
        Insert: {
          accent_color?: string
          banner_url?: string | null
          business_display_name?: string | null
          checkout_requires_account?: boolean
          company_id: string
          config?: Json
          contact_address?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_domain_status?: string
          custom_domain_token?: string | null
          custom_domain_verified_at?: string | null
          default_locale?: string
          email_from_name?: string | null
          email_reply_to?: string | null
          favicon_url?: string | null
          font_family?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          home_layout?: Json
          logo_url?: string | null
          organization_id: string
          require_payment_before_dispatch?: boolean
          store_id: string
          storefront_style?: Json
          support_email?: string | null
          tax_category_id?: string | null
          tax_inclusive?: boolean
          tax_rate?: number
          theme_preset?: string
          ui_density?: string | null
          ui_radius?: string | null
          updated_at?: string
          white_label?: boolean
        }
        Update: {
          accent_color?: string
          banner_url?: string | null
          business_display_name?: string | null
          checkout_requires_account?: boolean
          company_id?: string
          config?: Json
          contact_address?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_domain_status?: string
          custom_domain_token?: string | null
          custom_domain_verified_at?: string | null
          default_locale?: string
          email_from_name?: string | null
          email_reply_to?: string | null
          favicon_url?: string | null
          font_family?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          home_layout?: Json
          logo_url?: string | null
          organization_id?: string
          require_payment_before_dispatch?: boolean
          store_id?: string
          storefront_style?: Json
          support_email?: string | null
          tax_category_id?: string | null
          tax_inclusive?: boolean
          tax_rate?: number
          theme_preset?: string
          ui_density?: string | null
          ui_radius?: string | null
          updated_at?: string
          white_label?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "public_stores"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "store_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_settings_tax_category_fk"
            columns: ["tax_category_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "tax_categories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      store_warehouses: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          priority: number
          store_id: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          priority?: number
          store_id: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          priority?: number
          store_id?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_warehouses_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "store_warehouses_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      stores: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          domain: string | null
          id: string
          name: string
          order_seq: number
          organization_id: string
          return_seq: number
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          domain?: string | null
          id?: string
          name: string
          order_seq?: number
          organization_id: string
          return_seq?: number
          slug: string
          status?: Database["public"]["Enums"]["store_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          domain?: string | null
          id?: string
          name?: string
          order_seq?: number
          organization_id?: string
          return_seq?: number
          slug?: string
          status?: Database["public"]["Enums"]["store_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      tax_categories: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_rates: {
        Row: {
          company_id: string
          created_at: string
          id: string
          organization_id: string
          rate: number
          tax_category_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          organization_id: string
          rate: number
          tax_category_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          rate?: number
          tax_category_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_category_fk"
            columns: ["tax_category_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "tax_categories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      tenant_currencies: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          id: string
          is_base: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          id?: string
          is_base?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          id?: string
          is_base?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_currencies_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      tenant_entitlements: {
        Row: {
          company_id: string
          created_at: string
          entitlement_code: string
          id: string
          is_active: boolean
          organization_id: string
          source: Database["public"]["Enums"]["entitlement_source"]
          synced_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          entitlement_code: string
          id?: string
          is_active?: boolean
          organization_id: string
          source: Database["public"]["Enums"]["entitlement_source"]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          entitlement_code?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          source?: Database["public"]["Enums"]["entitlement_source"]
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_feature_flags: {
        Row: {
          company_id: string
          created_at: string
          flag_key: string
          id: string
          is_enabled: boolean
          note: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          flag_key: string
          id?: string
          is_enabled: boolean
          note?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          flag_key?: string
          id?: string
          is_enabled?: boolean
          note?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tenant_integrations: {
        Row: {
          company_id: string
          config: Json
          created_at: string
          direction: Database["public"]["Enums"]["integration_direction"]
          id: string
          is_active: boolean
          organization_id: string
          provider_code: string
          secret_ref: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          config?: Json
          created_at?: string
          direction?: Database["public"]["Enums"]["integration_direction"]
          id?: string
          is_active?: boolean
          organization_id: string
          provider_code: string
          secret_ref?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          config?: Json
          created_at?: string
          direction?: Database["public"]["Enums"]["integration_direction"]
          id?: string
          is_active?: boolean
          organization_id?: string
          provider_code?: string
          secret_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_integrations_provider_code_fkey"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      tenant_members: {
        Row: {
          company_id: string
          created_at: string
          email: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["organization_id"]
          },
        ]
      }
      tenant_platform_context: {
        Row: {
          app_active: boolean
          company_id: string
          created_at: string
          organization_id: string
          plan: string | null
          source: Database["public"]["Enums"]["entitlement_source"]
          synced_at: string
          updated_at: string
        }
        Insert: {
          app_active?: boolean
          company_id: string
          created_at?: string
          organization_id: string
          plan?: string | null
          source: Database["public"]["Enums"]["entitlement_source"]
          synced_at?: string
          updated_at?: string
        }
        Update: {
          app_active?: boolean
          company_id?: string
          created_at?: string
          organization_id?: string
          plan?: string | null
          source?: Database["public"]["Enums"]["entitlement_source"]
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          admin_email: string
          created_at: string
          name: string
          organization_id: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          admin_email: string
          created_at?: string
          name: string
          organization_id: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          admin_email?: string
          created_at?: string
          name?: string
          organization_id?: string
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      tracking_events: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          external_event_id: string
          id: string
          location: string | null
          occurred_at: string
          organization_id: string
          payload: Json
          provider_code: string | null
          provider_status: string | null
          shipment_id: string
          signature_verified: boolean
          source: Database["public"]["Enums"]["tracking_source"]
          status: Database["public"]["Enums"]["tracking_status"]
          store_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          external_event_id: string
          id?: string
          location?: string | null
          occurred_at: string
          organization_id: string
          payload?: Json
          provider_code?: string | null
          provider_status?: string | null
          shipment_id: string
          signature_verified?: boolean
          source?: Database["public"]["Enums"]["tracking_source"]
          status: Database["public"]["Enums"]["tracking_status"]
          store_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          external_event_id?: string
          id?: string
          location?: string | null
          occurred_at?: string
          organization_id?: string
          payload?: Json
          provider_code?: string | null
          provider_status?: string | null
          shipment_id?: string
          signature_verified?: boolean
          source?: Database["public"]["Enums"]["tracking_source"]
          status?: Database["public"]["Enums"]["tracking_status"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_shipment_fk"
            columns: ["shipment_id", "store_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "tracking_events_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          code: string
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          symbol: string | null
          updated_at: string
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          symbol?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      variant_attribute_values: {
        Row: {
          attribute_id: string
          company_id: string
          created_at: string
          id: string
          is_axis: boolean
          organization_id: string
          store_id: string
          updated_at: string
          value_id: string
          variant_id: string
        }
        Insert: {
          attribute_id: string
          company_id: string
          created_at?: string
          id?: string
          is_axis?: boolean
          organization_id: string
          store_id: string
          updated_at?: string
          value_id: string
          variant_id: string
        }
        Update: {
          attribute_id?: string
          company_id?: string
          created_at?: string
          id?: string
          is_axis?: boolean
          organization_id?: string
          store_id?: string
          updated_at?: string
          value_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_attribute_values_attribute_fk"
            columns: ["attribute_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "variant_attribute_values_axis_fk"
            columns: ["attribute_id", "is_axis"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id", "is_variant_axis"]
          },
          {
            foreignKeyName: "variant_attribute_values_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "variant_attribute_values_value_fk"
            columns: ["value_id", "attribute_id"]
            isOneToOne: false
            referencedRelation: "attribute_values"
            referencedColumns: ["id", "attribute_id"]
          },
          {
            foreignKeyName: "variant_attribute_values_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "variant_attribute_values_variant_fk"
            columns: ["variant_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_product_variants"
            referencedColumns: ["variant_id", "store_id"]
          },
        ]
      }
      warehouses: {
        Row: {
          allows_backorder: boolean
          city: string | null
          code: string
          company_id: string
          country: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          kind: Database["public"]["Enums"]["warehouse_kind"]
          name: string
          notes: string | null
          organization_id: string
          priority: number
          region: string | null
          source: Database["public"]["Enums"]["inventory_source"]
          stale_after: string | null
          stale_policy: Database["public"]["Enums"]["stock_staleness_policy"]
          updated_at: string
        }
        Insert: {
          allows_backorder?: boolean
          city?: string | null
          code: string
          company_id: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: Database["public"]["Enums"]["warehouse_kind"]
          name: string
          notes?: string | null
          organization_id: string
          priority?: number
          region?: string | null
          source?: Database["public"]["Enums"]["inventory_source"]
          stale_after?: string | null
          stale_policy?: Database["public"]["Enums"]["stock_staleness_policy"]
          updated_at?: string
        }
        Update: {
          allows_backorder?: boolean
          city?: string | null
          code?: string
          company_id?: string
          country?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: Database["public"]["Enums"]["warehouse_kind"]
          name?: string
          notes?: string | null
          organization_id?: string
          priority?: number
          region?: string | null
          source?: Database["public"]["Enums"]["inventory_source"]
          stale_after?: string | null
          stale_policy?: Database["public"]["Enums"]["stock_staleness_policy"]
          updated_at?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          company_id: string
          correlation_id: string | null
          created_at: string
          endpoint_id: string
          event_id: string
          event_type: string
          id: string
          organization_id: string
          outbox_id: string | null
          replay_of: string | null
          replay_reason: string | null
          replayed_by: string | null
        }
        Insert: {
          company_id: string
          correlation_id?: string | null
          created_at?: string
          endpoint_id: string
          event_id: string
          event_type: string
          id?: string
          organization_id: string
          outbox_id?: string | null
          replay_of?: string | null
          replay_reason?: string | null
          replayed_by?: string | null
        }
        Update: {
          company_id?: string
          correlation_id?: string | null
          created_at?: string
          endpoint_id?: string
          event_id?: string
          event_type?: string
          id?: string
          organization_id?: string
          outbox_id?: string | null
          replay_of?: string | null
          replay_reason?: string | null
          replayed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_fk"
            columns: ["endpoint_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_monitor"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_replay_fk"
            columns: ["replay_of", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_deliveries"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_replay_fk"
            columns: ["replay_of", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_monitor"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          api_version: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          max_attempts: number
          name: string
          organization_id: string
          secret_ref: string
          store_id: string | null
          updated_at: string
          url: string
        }
        Insert: {
          api_version?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          max_attempts?: number
          name: string
          organization_id: string
          secret_ref: string
          store_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          api_version?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          max_attempts?: number
          name?: string
          organization_id?: string
          secret_ref?: string
          store_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      webhook_subscriptions: {
        Row: {
          company_id: string
          created_at: string
          endpoint_id: string
          event_type: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          endpoint_id: string
          event_type: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          endpoint_id?: string
          event_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_subscriptions_endpoint_fk"
            columns: ["endpoint_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
    }
    Views: {
      admin_products: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          category_id: string | null
          category_name: string | null
          company_id: string | null
          compare_at_price: number | null
          currency: string | null
          description: string | null
          family_id: string | null
          id: string | null
          kind: Database["public"]["Enums"]["product_kind"] | null
          name: string | null
          organization_id: string | null
          price: number | null
          published_at: string | null
          sku: string | null
          slug: string | null
          status: Database["public"]["Enums"]["product_status"] | null
          stock: number | null
          store_id: string | null
          tax_category_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_fk"
            columns: ["brand_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "products_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_family_fk"
            columns: ["family_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "product_families"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "products_tax_category_fk"
            columns: ["tax_category_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "tax_categories"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      content_page_overview: {
        Row: {
          active_block_count: number | null
          block_count: number | null
          channel_code: string | null
          channel_id: string | null
          channel_name: string | null
          company_id: string | null
          created_at: string | null
          effective_status: string | null
          id: string | null
          kind: Database["public"]["Enums"]["content_page_kind"] | null
          live_block_count: number | null
          nav_position: number | null
          og_image_url: string | null
          organization_id: string | null
          priority: number | null
          publish_from: string | null
          publish_to: string | null
          seo_description: string | null
          seo_title: string | null
          show_in_nav: boolean | null
          slug: string | null
          status: Database["public"]["Enums"]["content_status"] | null
          store_id: string | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_pages_channel_fk"
            columns: ["channel_id", "store_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "content_pages_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      fulfillment_overview: {
        Row: {
          address: Json | null
          allocated_at: string | null
          company_id: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          delivered_at: string | null
          fulfillment_id: string | null
          fulfillment_status:
            | Database["public"]["Enums"]["fulfillment_status"]
            | null
          is_late: boolean | null
          method_code: string | null
          method_name: string | null
          order_id: string | null
          order_number: string | null
          order_status: Database["public"]["Enums"]["order_status"] | null
          organization_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          pickup_point_id: string | null
          pickup_point_name: string | null
          promised_from: string | null
          promised_to: string | null
          provider_code: string | null
          sequence: number | null
          shipment_count: number | null
          shipped_at: string | null
          shipping_cost: number | null
          state: Database["public"]["Enums"]["fulfillment_state"] | null
          store_id: string | null
          strategy: Database["public"]["Enums"]["delivery_strategy"] | null
          tracking_event_count: number | null
          tracking_number: string | null
          tracking_url: string | null
          unit_count: number | null
          warehouse_code: string | null
          warehouse_id: string | null
          weight: number | null
          window_date: string | null
          window_ends_at: string | null
          window_starts_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fulfillments_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_point_fk"
            columns: ["pickup_point_id", "store_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "fulfillments_provider_fk"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fulfillments_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "fulfillments_warehouse_fk"
            columns: ["warehouse_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      gift_card_overview: {
        Row: {
          balance: number | null
          code_last4: string | null
          company_id: string | null
          created_at: string | null
          currency: string | null
          effective_status: string | null
          expires_at: string | null
          id: string | null
          initial_amount: number | null
          issued_to_email: string | null
          last_redeemed_at: string | null
          movement_count: number | null
          notes: string | null
          organization_id: string | null
          redeemed_amount: number | null
          status: Database["public"]["Enums"]["gift_card_status"] | null
          store_id: string | null
          updated_at: string | null
        }
        Insert: {
          balance?: number | null
          code_last4?: string | null
          company_id?: string | null
          created_at?: string | null
          currency?: string | null
          effective_status?: never
          expires_at?: string | null
          id?: string | null
          initial_amount?: number | null
          issued_to_email?: string | null
          last_redeemed_at?: never
          movement_count?: never
          notes?: string | null
          organization_id?: string | null
          redeemed_amount?: never
          status?: Database["public"]["Enums"]["gift_card_status"] | null
          store_id?: string | null
          updated_at?: string | null
        }
        Update: {
          balance?: number | null
          code_last4?: string | null
          company_id?: string | null
          created_at?: string | null
          currency?: string | null
          effective_status?: never
          expires_at?: string | null
          id?: string | null
          initial_amount?: number | null
          issued_to_email?: string | null
          last_redeemed_at?: never
          movement_count?: never
          notes?: string | null
          organization_id?: string | null
          redeemed_amount?: never
          status?: Database["public"]["Enums"]["gift_card_status"] | null
          store_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      integration_monitor: {
        Row: {
          age_seconds: number | null
          attempts: number | null
          circuit_opened_at: string | null
          circuit_state: string | null
          claimed_at: string | null
          claimed_by: string | null
          company_id: string | null
          completed_at: string | null
          consecutive_fail: number | null
          correlation_id: string | null
          created_at: string | null
          id: string | null
          is_dead: boolean | null
          is_open: boolean | null
          is_retrying: boolean | null
          last_error: string | null
          max_attempts: number | null
          next_retry_at: string | null
          operation: string | null
          organization_id: string | null
          provider_code: string | null
          provider_kind: string | null
          provider_name: string | null
          status: string | null
          target: string | null
          target_label: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_provider_code_fkey"
            columns: ["provider_code"]
            isOneToOne: false
            referencedRelation: "integration_providers"
            referencedColumns: ["code"]
          },
        ]
      }
      inventory_alerts: {
        Row: {
          available_qty: number | null
          company_id: string | null
          kind: string | null
          name: string | null
          organization_id: string | null
          product_id: string | null
          reorder_point: number | null
          sku: string | null
          store_id: string | null
          synced_at: string | null
          variant_id: string | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: []
      }
      ops_incident_overview: {
        Row: {
          age_seconds: number | null
          code: string | null
          company_id: string | null
          context: Json | null
          correlation_id: string | null
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          is_open: boolean | null
          kind: Database["public"]["Enums"]["ops_event_kind"] | null
          message: string | null
          occurred_at: string | null
          operation: string | null
          organization_id: string | null
          repeats: number | null
          request_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["ops_severity"] | null
          source: string | null
          store_id: string | null
        }
        Insert: {
          age_seconds?: never
          code?: string | null
          company_id?: string | null
          context?: Json | null
          correlation_id?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          is_open?: never
          kind?: Database["public"]["Enums"]["ops_event_kind"] | null
          message?: string | null
          occurred_at?: string | null
          operation?: string | null
          organization_id?: string | null
          repeats?: never
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["ops_severity"] | null
          source?: string | null
          store_id?: string | null
        }
        Update: {
          age_seconds?: never
          code?: string | null
          company_id?: string | null
          context?: Json | null
          correlation_id?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          is_open?: never
          kind?: Database["public"]["Enums"]["ops_event_kind"] | null
          message?: string | null
          occurred_at?: string | null
          operation?: string | null
          organization_id?: string | null
          repeats?: never
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["ops_severity"] | null
          source?: string | null
          store_id?: string | null
        }
        Relationships: []
      }
      payment_intent_overview: {
        Row: {
          amount: number | null
          amount_authorized: number | null
          amount_captured: number | null
          amount_refunded: number | null
          attempt_count: number | null
          authorized_at: string | null
          capture_mode:
            | Database["public"]["Enums"]["payment_capture_mode"]
            | null
          captured_at: string | null
          company_id: string | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          failed_attempt_count: number | null
          intent_id: string | null
          last_error_code: string | null
          method_code: string | null
          method_kind: Database["public"]["Enums"]["payment_method_kind"] | null
          method_name: string | null
          order_id: string | null
          order_number: string | null
          order_payment_status:
            | Database["public"]["Enums"]["payment_status"]
            | null
          organization_id: string | null
          provider_code: string | null
          provider_reference: string | null
          refund_count: number | null
          status: Database["public"]["Enums"]["payment_intent_status"] | null
          store_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "payment_intents_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      promotion_overview: {
        Row: {
          audience_count: number | null
          buy_quantity: number | null
          code: string | null
          company_id: string | null
          coupon_count: number | null
          created_at: string | null
          description: string | null
          discount_granted: number | null
          effective_status: string | null
          exclusion_count: number | null
          free_quantity: number | null
          id: string | null
          is_exclusive: boolean | null
          kind: Database["public"]["Enums"]["promotion_kind"] | null
          max_discount_amount: number | null
          min_quantity: number | null
          min_subtotal: number | null
          name: string | null
          organization_id: string | null
          priority: number | null
          redemption_count: number | null
          requires_coupon: boolean | null
          scope_count: number | null
          stack_group: string | null
          status: Database["public"]["Enums"]["promotion_status"] | null
          store_id: string | null
          tier_count: number | null
          updated_at: string | null
          usage_count: number | null
          usage_limit: number | null
          usage_limit_per_customer: number | null
          valid_from: string | null
          valid_to: string | null
          value_amount: number | null
          value_percent: number | null
        }
        Insert: {
          audience_count?: never
          buy_quantity?: number | null
          code?: string | null
          company_id?: string | null
          coupon_count?: never
          created_at?: string | null
          description?: string | null
          discount_granted?: never
          effective_status?: never
          exclusion_count?: never
          free_quantity?: number | null
          id?: string | null
          is_exclusive?: boolean | null
          kind?: Database["public"]["Enums"]["promotion_kind"] | null
          max_discount_amount?: number | null
          min_quantity?: number | null
          min_subtotal?: number | null
          name?: string | null
          organization_id?: string | null
          priority?: number | null
          redemption_count?: never
          requires_coupon?: boolean | null
          scope_count?: never
          stack_group?: string | null
          status?: Database["public"]["Enums"]["promotion_status"] | null
          store_id?: string | null
          tier_count?: never
          updated_at?: string | null
          usage_count?: number | null
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value_amount?: number | null
          value_percent?: number | null
        }
        Update: {
          audience_count?: never
          buy_quantity?: number | null
          code?: string | null
          company_id?: string | null
          coupon_count?: never
          created_at?: string | null
          description?: string | null
          discount_granted?: never
          effective_status?: never
          exclusion_count?: never
          free_quantity?: number | null
          id?: string | null
          is_exclusive?: boolean | null
          kind?: Database["public"]["Enums"]["promotion_kind"] | null
          max_discount_amount?: number | null
          min_quantity?: number | null
          min_subtotal?: number | null
          name?: string | null
          organization_id?: string | null
          priority?: number | null
          redemption_count?: never
          requires_coupon?: boolean | null
          scope_count?: never
          stack_group?: string | null
          status?: Database["public"]["Enums"]["promotion_status"] | null
          store_id?: string | null
          tier_count?: never
          updated_at?: string | null
          usage_count?: number | null
          usage_limit?: number | null
          usage_limit_per_customer?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value_amount?: number | null
          value_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      public_categories: {
        Row: {
          category_id: string | null
          name: string | null
          parent_id: string | null
          position: number | null
          slug: string | null
          store_id: string | null
        }
        Relationships: []
      }
      public_delivery_methods: {
        Row: {
          code: string | null
          delivery_method_id: string | null
          description: string | null
          display_name: string | null
          instructions: string | null
          lead_time_max_days: number | null
          lead_time_min_days: number | null
          position: number | null
          requires_window: boolean | null
          store_id: string | null
          strategy: Database["public"]["Enums"]["delivery_strategy"] | null
        }
        Insert: {
          code?: string | null
          delivery_method_id?: string | null
          description?: string | null
          display_name?: string | null
          instructions?: string | null
          lead_time_max_days?: number | null
          lead_time_min_days?: number | null
          position?: number | null
          requires_window?: boolean | null
          store_id?: string | null
          strategy?: Database["public"]["Enums"]["delivery_strategy"] | null
        }
        Update: {
          code?: string | null
          delivery_method_id?: string | null
          description?: string | null
          display_name?: string | null
          instructions?: string | null
          lead_time_max_days?: number | null
          lead_time_min_days?: number | null
          position?: number | null
          requires_window?: boolean | null
          store_id?: string | null
          strategy?: Database["public"]["Enums"]["delivery_strategy"] | null
        }
        Relationships: []
      }
      public_payment_methods: {
        Row: {
          code: string | null
          display_name: string | null
          instructions: string | null
          kind: Database["public"]["Enums"]["payment_method_kind"] | null
          payment_method_id: string | null
          position: number | null
          store_id: string | null
        }
        Insert: {
          code?: string | null
          display_name?: string | null
          instructions?: string | null
          kind?: Database["public"]["Enums"]["payment_method_kind"] | null
          payment_method_id?: string | null
          position?: number | null
          store_id?: string | null
        }
        Update: {
          code?: string | null
          display_name?: string | null
          instructions?: string | null
          kind?: Database["public"]["Enums"]["payment_method_kind"] | null
          payment_method_id?: string | null
          position?: number | null
          store_id?: string | null
        }
        Relationships: []
      }
      public_product_images: {
        Row: {
          alt: string | null
          image_id: string | null
          is_primary: boolean | null
          position: number | null
          product_id: string | null
          storage_path: string | null
          store_id: string | null
        }
        Insert: {
          alt?: string | null
          image_id?: string | null
          is_primary?: boolean | null
          position?: number | null
          product_id?: string | null
          storage_path?: string | null
          store_id?: string | null
        }
        Update: {
          alt?: string | null
          image_id?: string | null
          is_primary?: boolean | null
          position?: number | null
          product_id?: string | null
          storage_path?: string | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_images_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
        ]
      }
      public_product_variants: {
        Row: {
          compare_at_price: number | null
          currency: string | null
          in_stock: boolean | null
          is_default: boolean | null
          name: string | null
          position: number | null
          price: number | null
          product_id: string | null
          store_id: string | null
          variant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "admin_products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "product_variants_product_fk"
            columns: ["product_id", "store_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["product_id", "store_id"]
          },
          {
            foreignKeyName: "products_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      public_products: {
        Row: {
          brand_name: string | null
          category_id: string | null
          category_name: string | null
          category_slug: string | null
          compare_at_price: number | null
          currency: string | null
          custom_fields: Json | null
          description: string | null
          in_stock: boolean | null
          kind: Database["public"]["Enums"]["product_kind"] | null
          name: string | null
          price: number | null
          price_from: number | null
          primary_image_alt: string | null
          primary_image_path: string | null
          product_id: string | null
          published_at: string | null
          slug: string | null
          store_id: string | null
          variant_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_fk"
            columns: ["category_id", "store_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "products_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      public_store_branding: {
        Row: {
          accent_color: string | null
          brand_slug: string | null
          business_display_name: string | null
          favicon_url: string | null
          font_family: string | null
          logo_url: string | null
          name: string | null
          ui_density: string | null
          ui_radius: string | null
          white_label: boolean | null
        }
        Relationships: []
      }
      public_stores: {
        Row: {
          accent_color: string | null
          banner_url: string | null
          business_display_name: string | null
          checkout_requires_account: boolean | null
          contact_address: string | null
          contact_phone: string | null
          currency: string | null
          default_locale: string | null
          domain: string | null
          favicon_url: string | null
          font_family: string | null
          hero_subtitle: string | null
          hero_title: string | null
          home_layout: Json | null
          logo_url: string | null
          name: string | null
          slug: string | null
          store_id: string | null
          storefront_style: Json | null
          support_email: string | null
          theme_preset: string | null
          ui_density: string | null
          ui_radius: string | null
          white_label: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_currency_fk"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      return_overview: {
        Row: {
          company_id: string | null
          completed_at: string | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          customer_note: string | null
          decided_at: string | null
          decided_email: string | null
          decision_note: string | null
          evidence_count: number | null
          inspected_at: string | null
          order_id: string | null
          order_number: string | null
          organization_id: string | null
          reason_code: string | null
          reason_label: string | null
          received_at: string | null
          received_count: number | null
          refund_amount: number | null
          resolution: Database["public"]["Enums"]["return_resolution"] | null
          restocked_count: number | null
          return_request_id: string | null
          rma_number: string | null
          source: Database["public"]["Enums"]["return_source"] | null
          state: Database["public"]["Enums"]["return_state"] | null
          store_id: string | null
          unit_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "return_requests_order_fk"
            columns: ["order_id", "store_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "store_id"]
          },
          {
            foreignKeyName: "return_requests_store_fk"
            columns: ["store_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
      webhook_monitor: {
        Row: {
          age_seconds: number | null
          attempts: number | null
          company_id: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string | null
          endpoint_active: boolean | null
          endpoint_id: string | null
          endpoint_name: string | null
          endpoint_url: string | null
          event_id: string | null
          event_type: string | null
          id: string | null
          is_replay: boolean | null
          last_error: string | null
          last_status_code: number | null
          max_attempts: number | null
          next_retry_at: string | null
          organization_id: string | null
          outbox_id: string | null
          replay_of: string | null
          replay_reason: string | null
          replayed_by: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_fk"
            columns: ["endpoint_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_monitor"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_outbox_fk"
            columns: ["outbox_id", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_replay_fk"
            columns: ["replay_of", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_deliveries"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
          {
            foreignKeyName: "webhook_deliveries_replay_fk"
            columns: ["replay_of", "organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "webhook_monitor"
            referencedColumns: ["id", "organization_id", "company_id"]
          },
        ]
      }
    }
    Functions: {
      accept_order_suggestion: {
        Args: { p_suggestion_id: string }
        Returns: Json
      }
      add_business_account_user: {
        Args: {
          p_account_id: string
          p_email: string
          p_location_id?: string
          p_role: Database["public"]["Enums"]["business_role"]
          p_spending_limit?: number
          p_status?: Database["public"]["Enums"]["member_status"]
        }
        Returns: string
      }
      add_tenant_member: {
        Args: {
          p_email: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      adjust_inventory: {
        Args: {
          p_external_ref?: string
          p_kind?: string
          p_product_id: string
          p_quantity?: number
          p_reason?: string
          p_variant_id?: string
          p_warehouse_id: string
        }
        Returns: Json
      }
      ai_consume: {
        Args: { p_feature?: string; p_units?: number }
        Returns: Json
      }
      ai_consume_for_store: {
        Args: { p_feature?: string; p_store_slug: string; p_units?: number }
        Returns: Json
      }
      ai_entitlement: { Args: never; Returns: Json }
      ai_feedback: {
        Args: { p_interaction: string; p_value: number }
        Returns: boolean
      }
      ai_record: {
        Args: {
          p_cache_read_tokens?: number
          p_feature: string
          p_input_tokens?: number
          p_latency_ms?: number
          p_model?: string
          p_output_tokens?: number
          p_prompt?: string
          p_reply?: string
          p_status: string
        }
        Returns: string
      }
      ai_record_for_store: {
        Args: {
          p_cache_read_tokens?: number
          p_feature: string
          p_input_tokens?: number
          p_latency_ms?: number
          p_model?: string
          p_output_tokens?: number
          p_prompt?: string
          p_reply?: string
          p_status: string
          p_store_slug: string
        }
        Returns: string
      }
      ai_usage_by_feature: { Args: never; Returns: Json }
      analytics_channel_performance: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: {
          channel_code: string
          channel_id: string
          channel_kind: string
          channel_name: string
          currency: string
          orders: number
          revenue: string
          units: number
        }[]
      }
      analytics_funnel: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: {
          event_type: string
          events: number
          sessions: number
        }[]
      }
      analytics_kpis: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: Json
      }
      analytics_search_terms: {
        Args: {
          p_from?: string
          p_limit?: number
          p_store_id?: string
          p_to?: string
        }
        Returns: {
          searches: number
          sessions: number
          term: string
          zero_results: number
        }[]
      }
      analytics_timeseries: {
        Args: { p_from?: string; p_store_id?: string; p_to?: string }
        Returns: {
          currency: string
          day: string
          orders: number
          revenue: string
          units: number
        }[]
      }
      analytics_top_products: {
        Args: {
          p_from?: string
          p_limit?: number
          p_store_id?: string
          p_to?: string
        }
        Returns: {
          currency: string
          name: string
          orders: number
          product_id: string
          revenue: string
          sku: string
          units: number
        }[]
      }
      api_authenticate: {
        Args: { p_scope?: string; p_token_hash: string }
        Returns: Json
      }
      api_client_create: {
        Args: {
          p_description?: string
          p_expires_at?: string
          p_name: string
          p_rate_limit?: number
          p_scopes: string[]
        }
        Returns: Json
      }
      api_client_rotate_secret: {
        Args: { p_client_ref: string }
        Returns: Json
      }
      api_customers_list: {
        Args: { p_api_client_id: string; p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      api_idempotency_begin: {
        Args: { p_api_client_id: string; p_key: string; p_request_hash: string }
        Returns: Json
      }
      api_idempotency_finish: {
        Args: {
          p_api_client_id: string
          p_key: string
          p_response: Json
          p_status: number
        }
        Returns: undefined
      }
      api_order_create: {
        Args: { p_api_client_id: string; p_payload: Json }
        Returns: Json
      }
      api_order_get: {
        Args: { p_api_client_id: string; p_number: string; p_store?: string }
        Returns: Json
      }
      api_orders_list: {
        Args: {
          p_api_client_id: string
          p_cursor?: string
          p_limit?: number
          p_status?: string
          p_store?: string
        }
        Returns: Json
      }
      api_products_list: {
        Args: {
          p_api_client_id: string
          p_cursor?: string
          p_limit?: number
          p_store?: string
        }
        Returns: Json
      }
      api_rate_limit_hit: {
        Args: { p_api_client_id: string; p_method: string; p_route: string }
        Returns: Json
      }
      api_request_complete: {
        Args: { p_request_id: string; p_status: number }
        Returns: undefined
      }
      api_stock_read: {
        Args: { p_api_client_id: string; p_sku: string; p_store?: string }
        Returns: Json
      }
      api_token_issue: {
        Args: {
          p_client_id: string
          p_scopes?: string[]
          p_secret: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      audit_record: {
        Args: {
          p_action: string
          p_company_id: string
          p_entity_id?: string
          p_entity_label?: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id: string
          p_store_id?: string
        }
        Returns: string
      }
      availability_for_slug: {
        Args: { p_items: Json; p_store_slug: string }
        Returns: Json
      }
      bootstrap_tenant: {
        Args: {
          p_admin_email: string
          p_company_id: string
          p_currency?: string
          p_organization_id: string
          p_owner_user_id: string
          p_store_name: string
          p_store_slug: string
          p_tenant_name: string
          p_tenant_slug: string
        }
        Returns: Json
      }
      cart_abandon: {
        Args: { p_store_slug: string; p_token: string }
        Returns: Json
      }
      cart_open: {
        Args: { p_store_slug: string; p_token?: string }
        Returns: Json
      }
      cart_price_drift: {
        Args: { p_store_slug: string; p_token: string }
        Returns: Json
      }
      cart_replace_lines: {
        Args: { p_lines: Json; p_store_slug: string; p_token: string }
        Returns: Json
      }
      catalog_search: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
          p_store_id: string
        }
        Returns: Json
      }
      catalog_search_for_slug: {
        Args: {
          p_filters?: Json
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_sort?: string
          p_store_slug: string
        }
        Returns: Json
      }
      catalog_suggest_for_slug: {
        Args: { p_limit?: number; p_query: string; p_store_slug: string }
        Returns: Json
      }
      category_deletion_usage: {
        Args: { p_category_id: string }
        Returns: Json
      }
      checkout_begin: {
        Args: {
          p_cart_token?: string
          p_idempotency_key: string
          p_request_hash: string
          p_store_slug: string
        }
        Returns: Json
      }
      checkout_context: { Args: { p_store_slug: string }; Returns: Json }
      checkout_fail: {
        Args: {
          p_code: string
          p_detail?: string
          p_intent_id: string
          p_stage: Database["public"]["Enums"]["checkout_stage"]
        }
        Returns: undefined
      }
      checkout_mark_stage: {
        Args: {
          p_intent_id: string
          p_reservation_token?: string
          p_stage: Database["public"]["Enums"]["checkout_stage"]
        }
        Returns: undefined
      }
      checkout_place_order: {
        Args: {
          p_approval?: Json
          p_billing_address?: Json
          p_business_account_id?: string
          p_coupon_codes?: string[]
          p_customer_email: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery?: Json
          p_intent_id: string
          p_items: Json
          p_notes?: string
          p_payment?: Json
          p_reservation_token?: string
          p_shipping_address?: Json
        }
        Returns: Json
      }
      claim_domain_events: {
        Args: { p_event_types?: string[]; p_limit?: number; p_worker: string }
        Returns: {
          aggregate_id: string | null
          aggregate_type: string
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          correlation_id: string | null
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          organization_id: string
          payload: Json
          processed_at: string | null
          status: Database["public"]["Enums"]["domain_event_status"]
          store_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "domain_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      commit_inventory_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
      }
      complete_domain_event: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      content_preview: {
        Args: {
          p_at?: string
          p_channel_id?: string
          p_include_drafts?: boolean
          p_page_id: string
          p_segment_id?: string
        }
        Returns: Json
      }
      create_order: {
        Args: {
          p_approval?: Json
          p_billing_address?: Json
          p_business_account_id?: string
          p_coupon_codes?: string[]
          p_customer_email: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery?: Json
          p_items: Json
          p_notes?: string
          p_reservation_token?: string
          p_shipping_address?: Json
          p_source_channel?: string
          p_store_id: string
        }
        Returns: Json
      }
      create_order_for_slug: {
        Args: {
          p_approval?: Json
          p_billing_address?: Json
          p_business_account_id?: string
          p_coupon_codes?: string[]
          p_customer_email: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery?: Json
          p_items: Json
          p_notes?: string
          p_reservation_token?: string
          p_shipping_address?: Json
          p_source_channel?: string
          p_store_slug: string
        }
        Returns: Json
      }
      current_buyer: { Args: never; Returns: Json }
      customer_aging: { Args: { p_customer: string }; Returns: Json }
      customer_deletion_usage: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      customer_orders: {
        Args: { p_customer_id: string }
        Returns: {
          currency: string
          grand_total: string
          order_id: string
          order_number: string
          placed_at: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
        }[]
      }
      dashboard_kpis: { Args: { p_store_id?: string }; Returns: Json }
      dashboard_recent_orders: { Args: { p_store_id?: string }; Returns: Json }
      delivery_options_for_order: {
        Args: { p_order_id: string }
        Returns: Json
      }
      delivery_options_for_slug: {
        Args: { p_address: Json; p_items: Json; p_store_slug: string }
        Returns: Json
      }
      discard_order_suggestion: {
        Args: { p_suggestion_id: string }
        Returns: undefined
      }
      effective_capabilities: { Args: { p_company_id?: string }; Returns: Json }
      expire_carts: { Args: never; Returns: number }
      expire_gift_cards: { Args: { p_store_id?: string }; Returns: number }
      expire_inventory_reservations: { Args: never; Returns: number }
      fail_domain_event: {
        Args: { p_error: string; p_event_id: string }
        Returns: undefined
      }
      fulfillment_assign: {
        Args: { p_fulfillment_id: string; p_warehouse_id?: string }
        Returns: Json
      }
      fulfillment_create: {
        Args: {
          p_lines?: Json
          p_method_code: string
          p_order_id: string
          p_pickup_point_id?: string
          p_window?: Json
        }
        Returns: Json
      }
      fulfillment_transition: {
        Args: { p_fulfillment_id: string; p_reason?: string; p_to: string }
        Returns: Json
      }
      gift_card_adjust: {
        Args: { p_amount: number; p_gift_card_id: string; p_reason: string }
        Returns: Json
      }
      gift_card_attach_order: {
        Args: {
          p_gift_card_id: string
          p_order_id: string
          p_reference: string
        }
        Returns: number
      }
      gift_card_balance_for_slug: {
        Args: { p_code: string; p_store_slug: string }
        Returns: Json
      }
      gift_card_cancel: {
        Args: { p_gift_card_id: string; p_reason: string }
        Returns: Json
      }
      gift_card_issue: {
        Args: {
          p_amount: number
          p_email?: string
          p_expires_at?: string
          p_notes?: string
          p_store_id: string
        }
        Returns: Json
      }
      gift_card_redeem: {
        Args: {
          p_amount: number
          p_code: string
          p_order_id?: string
          p_reference: string
          p_store_slug: string
        }
        Returns: Json
      }
      gift_card_release: {
        Args: { p_amount: number; p_gift_card_id: string; p_reference: string }
        Returns: Json
      }
      integration_circuit_reset: {
        Args: { p_circuit_id: string; p_reason: string }
        Returns: Json
      }
      integration_claim: {
        Args: { p_limit?: number; p_provider_code: string; p_worker: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          operation: string
          organization_id: string
          payload: Json
          provider_code: string
          status: Database["public"]["Enums"]["outbox_status"]
          target: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      integration_enqueue: {
        Args: {
          p_company_id: string
          p_idempotency_key: string
          p_operation: string
          p_organization_id: string
          p_payload: Json
          p_provider_code: string
          p_target?: string
        }
        Returns: string
      }
      integration_fail: {
        Args: { p_error: string; p_outbox_id: string; p_status_code?: number }
        Returns: undefined
      }
      integration_health: { Args: never; Returns: Json }
      integration_message_detail: {
        Args: { p_outbox_id: string }
        Returns: Json
      }
      integration_reclaim_stale: {
        Args: { p_older_than?: string }
        Returns: number
      }
      integration_retry: {
        Args: { p_outbox_id: string; p_reason: string }
        Returns: Json
      }
      integration_succeed: {
        Args: {
          p_latency_ms?: number
          p_outbox_id: string
          p_status_code?: number
        }
        Returns: undefined
      }
      inventory_availability: {
        Args: { p_items: Json; p_store_id: string }
        Returns: Json
      }
      my_account_statement: { Args: never; Returns: Json }
      my_business_accounts: { Args: never; Returns: Json }
      my_business_order_detail: { Args: { p_order_id: string }; Returns: Json }
      my_business_orders: {
        Args: { p_limit?: number; p_only_pending?: boolean }
        Returns: Json
      }
      my_coupons: { Args: { p_store_id: string }; Returns: Json }
      my_order_suggestions: { Args: never; Returns: Json }
      my_pending_business_accounts: { Args: never; Returns: Json }
      my_product_favorites: {
        Args: { p_store_id: string }
        Returns: {
          product_id: string
        }[]
      }
      my_stores: { Args: never; Returns: Json }
      notification_email_claim: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          id: string
          kind: string
          locale: string
          params: Json
          to_address: string
        }[]
      }
      notification_email_complete: {
        Args: { p_id: string; p_reference?: string }
        Returns: undefined
      }
      notification_email_fail: {
        Args: { p_error: string; p_id: string; p_retryable?: boolean }
        Returns: undefined
      }
      ops_health: { Args: { p_store_id?: string }; Returns: Json }
      ops_record_event: {
        Args: {
          p_code: string
          p_company_id: string
          p_context?: Json
          p_correlation_id?: string
          p_dedupe_key: string
          p_duration_ms?: number
          p_entity_id?: string
          p_entity_type?: string
          p_kind: Database["public"]["Enums"]["ops_event_kind"]
          p_message?: string
          p_operation?: string
          p_organization_id: string
          p_severity?: Database["public"]["Enums"]["ops_severity"]
          p_source?: string
          p_store_id?: string
        }
        Returns: string
      }
      ops_resolve_event: {
        Args: { p_event_id: string; p_note: string }
        Returns: Json
      }
      order_approval_decide: {
        Args: { p_approve: boolean; p_order_id: string; p_reason?: string }
        Returns: Json
      }
      order_by_token: {
        Args: { p_order_number: string; p_store_slug: string; p_token: string }
        Returns: Json
      }
      order_transition: {
        Args: {
          p_axis: string
          p_order_id: string
          p_reason?: string
          p_to: string
        }
        Returns: Json
      }
      payment_apply_outcome: {
        Args: {
          p_amount?: number
          p_attempt_status: string
          p_error_code?: string
          p_error_detail?: string
          p_external_event_id?: string
          p_idempotency_key: string
          p_intent_id: string
          p_intent_status?: string
          p_latency_ms?: number
          p_operation: string
          p_payload?: Json
          p_provider_reference?: string
          p_provider_result_code?: string
          p_signature_verified?: boolean
          p_source?: string
        }
        Returns: Json
      }
      payment_intent_attach_order: {
        Args: { p_intent_id: string; p_order_id: string }
        Returns: Json
      }
      payment_intent_open: {
        Args: {
          p_amount: number
          p_currency: string
          p_idempotency_key: string
          p_method_code: string
          p_order_id?: string
          p_store_slug: string
        }
        Returns: Json
      }
      payment_reconciliation_import: {
        Args: { p_provider_code: string; p_rows: Json }
        Returns: Json
      }
      payment_reconciliation_match: {
        Args: { p_payment_id: string; p_record_id: string }
        Returns: Json
      }
      payment_refund_request: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_payment_id: string
          p_reason?: string
        }
        Returns: Json
      }
      payment_refund_settle: {
        Args: {
          p_error_code?: string
          p_error_detail?: string
          p_external_event_id?: string
          p_payload?: Json
          p_provider_reference?: string
          p_refund_id: string
          p_signature_verified?: boolean
          p_source?: string
          p_status: string
        }
        Returns: Json
      }
      price_list_conflicts: {
        Args: { p_store_id: string }
        Returns: {
          detail: string
          kind: string
          other_list_code: string
          other_list_id: string
          price_list_code: string
          price_list_id: string
          scope: string
        }[]
      }
      price_quote: {
        Args: {
          p_at?: string
          p_channel_id?: string
          p_customer_id?: string
          p_items: Json
          p_segment_id?: string
          p_store_id: string
        }
        Returns: Json
      }
      price_quote_for_slug: {
        Args: { p_items: Json; p_store_slug: string }
        Returns: Json
      }
      product_deletion_usage: { Args: { p_product_id: string }; Returns: Json }
      promotion_quote_for_slug: {
        Args: { p_coupon_codes?: string[]; p_items: Json; p_store_slug: string }
        Returns: Json
      }
      promotion_simulate: {
        Args: {
          p_at?: string
          p_channel_id?: string
          p_coupon_codes?: string[]
          p_customer_id?: string
          p_items: Json
          p_segment_id?: string
          p_store_id: string
        }
        Returns: Json
      }
      purchase_approval: {
        Args: { p_amount: number; p_business_account_id: string }
        Returns: Json
      }
      purge_api_idempotency: {
        Args: { p_older_than?: string }
        Returns: number
      }
      purge_api_requests: { Args: { p_older_than?: string }; Returns: number }
      purge_api_tokens: { Args: { p_older_than?: string }; Returns: number }
      purge_checkout_attempts: {
        Args: { p_older_than?: string }
        Returns: number
      }
      purge_empty_guest_carts: {
        Args: { p_older_than?: string }
        Returns: number
      }
      purge_public_rate_events: {
        Args: { p_older_than?: string }
        Returns: number
      }
      reclaim_stale_domain_events: {
        Args: { p_older_than?: string }
        Returns: number
      }
      release_inventory_by_token: {
        Args: { p_store_slug: string; p_token: string }
        Returns: Json
      }
      release_inventory_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: Json
      }
      reorder_product_images: {
        Args: { p_image_ids: string[]; p_product_id: string }
        Returns: undefined
      }
      reserve_inventory: {
        Args: {
          p_items: Json
          p_reference_key: string
          p_reference_kind?: string
          p_store_id: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      reserve_inventory_for_slug: {
        Args: {
          p_items: Json
          p_reference_key: string
          p_store_slug: string
          p_ttl_seconds?: number
        }
        Returns: Json
      }
      return_cancel: {
        Args: { p_reason: string; p_return_id: string }
        Returns: Json
      }
      return_complete: {
        Args: { p_note?: string; p_resolution?: string; p_return_id: string }
        Returns: Json
      }
      return_decide: {
        Args: { p_decision: string; p_note?: string; p_return_id: string }
        Returns: Json
      }
      return_evidence_attach: {
        Args: {
          p_caption?: string
          p_content_type: string
          p_return_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: Json
      }
      return_inspect: {
        Args: {
          p_items: Json
          p_note?: string
          p_refund_amount?: number
          p_return_id: string
        }
        Returns: Json
      }
      return_open: {
        Args: {
          p_items: Json
          p_note?: string
          p_order_id: string
          p_reason_code: string
        }
        Returns: Json
      }
      return_receive: {
        Args: { p_items?: Json; p_note?: string; p_return_id: string }
        Returns: Json
      }
      return_request_for_slug: {
        Args: {
          p_items: Json
          p_note?: string
          p_order_number: string
          p_reason_code: string
          p_store_slug: string
          p_token: string
        }
        Returns: Json
      }
      returns_by_token: {
        Args: { p_order_number: string; p_store_slug: string; p_token: string }
        Returns: Json
      }
      seed_inventory_from_catalog: {
        Args: { p_store_id: string; p_warehouse_id: string }
        Returns: Json
      }
      set_inventory_policy: {
        Args: {
          p_product_id: string
          p_reorder_point?: number
          p_safety_stock?: number
          p_variant_id?: string
          p_warehouse_id: string
        }
        Returns: Json
      }
      set_primary_product_image: {
        Args: { p_image_id: string }
        Returns: undefined
      }
      set_tax_rate: {
        Args: { p_rate: number; p_tax_category_id: string }
        Returns: Json
      }
      shipment_apply_outcome: {
        Args: {
          p_cost?: number
          p_currency?: string
          p_error_code?: string
          p_error_detail?: string
          p_estimated?: string
          p_label_ref?: string
          p_shipment_id: string
          p_state: string
          p_tracking_number?: string
          p_tracking_url?: string
        }
        Returns: Json
      }
      shipment_open: {
        Args: {
          p_fulfillment_id: string
          p_idempotency_key: string
          p_lines?: Json
          p_service_code?: string
        }
        Returns: Json
      }
      shipment_track_ingest: {
        Args: {
          p_events: Json
          p_shipment_id: string
          p_signature_verified?: boolean
          p_source?: string
        }
        Returns: Json
      }
      shipment_track_note: {
        Args: {
          p_description?: string
          p_occurred_at?: string
          p_shipment_id: string
          p_status: string
        }
        Returns: Json
      }
      store_domain_claim: { Args: { p_store_id: string }; Returns: Json }
      store_navigation_for_slug: {
        Args: { p_channel_code?: string; p_store_slug: string }
        Returns: Json
      }
      store_page_for_slug: {
        Args: {
          p_channel_code?: string
          p_page_slug?: string
          p_store_slug: string
        }
        Returns: Json
      }
      store_promotions_for_slug: {
        Args: { p_limit?: number; p_store_slug: string }
        Returns: Json
      }
      suggest_order: {
        Args: { p_customer: string; p_days?: number; p_store: string }
        Returns: {
          last_period_quantity: number
          product_id: string
          reason: string
          suggested_quantity: number
          variant_id: string
        }[]
      }
      sync_inventory_level: {
        Args: {
          p_external_ref?: string
          p_on_hand?: number
          p_product_id: string
          p_reason?: string
          p_variant_id?: string
          p_warehouse_id: string
        }
        Returns: Json
      }
      sync_platform_context: {
        Args: {
          p_app_active: boolean
          p_company_id: string
          p_entitlements: string[]
          p_organization_id: string
          p_plan?: string
          p_source: Database["public"]["Enums"]["entitlement_source"]
        }
        Returns: Json
      }
      toggle_product_favorite: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      trace_by_correlation: {
        Args: { p_correlation_id: string }
        Returns: {
          domain: string
          entity_id: string
          entity_type: string
          occurred_at: string
          severity: string
          status: string
          summary: string
        }[]
      }
      track_events_for_slug: {
        Args: { p_events: Json; p_session: string; p_store_slug: string }
        Returns: Json
      }
      webhook_replay: {
        Args: { p_delivery_id: string; p_reason: string }
        Returns: Json
      }
    }
    Enums: {
      address_verification: "unverified" | "pending" | "verified" | "rejected"
      analytics_event_type:
        | "product_view"
        | "search"
        | "add_to_cart"
        | "checkout_started"
        | "checkout_completed"
        | "cart_abandoned"
        | "order_created"
        | "order_completed"
        | "promotion_used"
      analytics_source: "storefront" | "server"
      app_role:
        | "owner"
        | "admin"
        | "catalog"
        | "orders"
        | "viewer"
        | "sales_rep"
      ar_document_kind: "invoice" | "debit_note" | "credit_note"
      assortment_scope:
        | "store"
        | "channel"
        | "territory"
        | "segment"
        | "customer"
      attribute_data_type: "text" | "number" | "boolean" | "date" | "option"
      audit_actor_kind: "user" | "service" | "support" | "system"
      business_role: "admin" | "buyer" | "approver" | "viewer"
      cart_status: "active" | "converted" | "abandoned" | "merged"
      channel_kind: "b2c" | "b2b" | "internal"
      checkout_intent_status: "running" | "succeeded" | "failed"
      checkout_stage:
        | "resolve_context"
        | "validate_account"
        | "resolve_prices"
        | "resolve_promotions"
        | "calculate_taxes"
        | "reserve_inventory"
        | "validate_delivery"
        | "authorize_payment"
        | "create_order"
        | "publish_events"
        | "notify"
      circuit_state: "closed" | "open" | "half_open"
      commission_status: "draft" | "approved" | "paid"
      content_block_type:
        | "hero"
        | "banner"
        | "carousel"
        | "product_collection"
        | "category_collection"
        | "rich_text"
        | "campaign"
        | "slider"
      content_item_kind: "product" | "variant" | "category" | "media"
      content_page_kind: "home" | "landing" | "legal"
      content_status: "draft" | "published" | "archived"
      credit_status: "ok" | "watch" | "blocked"
      customer_kind: "person" | "company"
      customer_tier: "a" | "b" | "c"
      delivery_plan_status: "draft" | "dispatched" | "closed" | "cancelled"
      delivery_strategy: "ship" | "pickup" | "local_delivery" | "digital"
      domain_event_status:
        | "pending"
        | "in_flight"
        | "processed"
        | "failed"
        | "dead"
      entitlement_source: "hub" | "provisioning"
      fulfillment_state:
        | "pending"
        | "allocated"
        | "picking"
        | "packed"
        | "ready"
        | "in_transit"
        | "delivered"
        | "failed"
        | "cancelled"
      fulfillment_status:
        | "unfulfilled"
        | "in_progress"
        | "partially_fulfilled"
        | "fulfilled"
        | "returned"
        | "cancelled"
      gift_card_movement:
        | "issue"
        | "redeem"
        | "refund"
        | "adjust"
        | "expire"
        | "cancel"
      gift_card_status: "active" | "depleted" | "expired" | "cancelled"
      goal_metric: "amount" | "units" | "orders" | "coverage"
      integration_direction: "outbound" | "inbound" | "bidirectional"
      integration_kind:
        | "erp"
        | "payment"
        | "invoicing"
        | "logistics"
        | "messaging"
        | "identity"
        | "webhook"
      inventory_source: "local" | "erp"
      invoice_status:
        | "pending"
        | "issued"
        | "accepted"
        | "rejected"
        | "cancelled"
      member_status: "active" | "invited" | "revoked"
      movement_kind:
        | "receipt"
        | "issue"
        | "return"
        | "adjustment"
        | "count"
        | "transfer_in"
        | "transfer_out"
      ops_event_kind:
        | "checkout_failed"
        | "payment_failed"
        | "integration_failed"
        | "event_undelivered"
        | "webhook_rejected"
        | "slow_operation"
      ops_severity: "info" | "warning" | "error" | "critical"
      order_approval_status:
        | "not_required"
        | "pending"
        | "approved"
        | "rejected"
      order_event_axis:
        | "order_status"
        | "payment_status"
        | "fulfillment_status"
        | "approval_status"
      order_event_source:
        | "storefront"
        | "backoffice"
        | "system"
        | "api"
        | "import"
      order_schedule_status: "active" | "paused" | "finished"
      order_source_channel:
        | "storefront"
        | "backoffice"
        | "api"
        | "import"
        | "scheduled"
        | "repeat"
      order_status: "pending" | "paid" | "fulfilled" | "cancelled" | "refunded"
      outbox_status: "pending" | "in_flight" | "succeeded" | "failed" | "dead"
      payment_attempt_status:
        | "pending"
        | "succeeded"
        | "declined"
        | "failed"
        | "timeout"
      payment_capture_mode: "automatic" | "manual"
      payment_event_source:
        | "provider_response"
        | "provider_webhook"
        | "browser_return"
        | "operator"
        | "system"
      payment_intent_status:
        | "open"
        | "processing"
        | "requires_action"
        | "authorized"
        | "captured"
        | "failed"
        | "cancelled"
        | "expired"
      payment_method_kind:
        | "card"
        | "wallet"
        | "bank_transfer"
        | "cash"
        | "credit"
        | "other"
      payment_record_status: "captured" | "partially_refunded" | "refunded"
      payment_status:
        | "pending"
        | "authorized"
        | "paid"
        | "partially_refunded"
        | "refunded"
        | "failed"
        | "voided"
      pod_outcome: "delivered" | "partial" | "refused" | "not_found"
      price_scope: "store" | "channel" | "segment" | "customer"
      product_kind: "simple" | "variant" | "bundle"
      product_relation_kind:
        | "related"
        | "cross_sell"
        | "up_sell"
        | "accessory"
        | "substitute"
        | "spare_part"
      product_status: "draft" | "published" | "archived"
      promotion_audience_kind:
        | "all"
        | "channel"
        | "segment"
        | "customer"
        | "business_account"
      promotion_kind:
        | "percentage"
        | "fixed_amount"
        | "volume_tier"
        | "x_for_y"
        | "bundle"
      promotion_scope_kind: "all" | "product" | "variant" | "category" | "brand"
      promotion_status: "draft" | "active" | "paused" | "archived"
      quote_status: "draft" | "sent" | "accepted" | "rejected" | "expired"
      reconciliation_status: "unmatched" | "matched" | "discrepancy" | "ignored"
      refund_status:
        | "requested"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
      reservation_status: "held" | "committed" | "released" | "expired"
      return_item_condition:
        | "pending"
        | "sellable"
        | "damaged"
        | "used"
        | "missing"
      return_resolution: "refund" | "exchange" | "store_credit" | "repair"
      return_source: "storefront" | "backoffice" | "api"
      return_state:
        | "requested"
        | "approved"
        | "rejected"
        | "in_transit"
        | "received"
        | "inspected"
        | "completed"
        | "cancelled"
      shipment_state:
        | "draft"
        | "created"
        | "picked_up"
        | "in_transit"
        | "out_for_delivery"
        | "delivered"
        | "failed"
        | "returned"
        | "cancelled"
      sourcing_strategy: "store_priority" | "single_warehouse_atp"
      stock_staleness_policy: "unknown" | "trust_last_known"
      store_status: "draft" | "active" | "suspended"
      suggestion_status: "draft" | "sent" | "accepted" | "discarded"
      tenant_status: "active" | "suspended" | "closed"
      tracking_source:
        | "provider_webhook"
        | "provider_poll"
        | "operator"
        | "system"
      tracking_status:
        | "label_created"
        | "picked_up"
        | "in_transit"
        | "out_for_delivery"
        | "delivery_attempted"
        | "delivered"
        | "exception"
        | "returned"
        | "cancelled"
        | "info"
      visit_frequency: "weekly" | "biweekly" | "monthly" | "on_demand"
      visit_outcome:
        | "planned"
        | "completed"
        | "no_order"
        | "closed"
        | "rescheduled"
      warehouse_kind: "warehouse" | "store" | "virtual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      address_verification: ["unverified", "pending", "verified", "rejected"],
      analytics_event_type: [
        "product_view",
        "search",
        "add_to_cart",
        "checkout_started",
        "checkout_completed",
        "cart_abandoned",
        "order_created",
        "order_completed",
        "promotion_used",
      ],
      analytics_source: ["storefront", "server"],
      app_role: ["owner", "admin", "catalog", "orders", "viewer", "sales_rep"],
      ar_document_kind: ["invoice", "debit_note", "credit_note"],
      assortment_scope: [
        "store",
        "channel",
        "territory",
        "segment",
        "customer",
      ],
      attribute_data_type: ["text", "number", "boolean", "date", "option"],
      audit_actor_kind: ["user", "service", "support", "system"],
      business_role: ["admin", "buyer", "approver", "viewer"],
      cart_status: ["active", "converted", "abandoned", "merged"],
      channel_kind: ["b2c", "b2b", "internal"],
      checkout_intent_status: ["running", "succeeded", "failed"],
      checkout_stage: [
        "resolve_context",
        "validate_account",
        "resolve_prices",
        "resolve_promotions",
        "calculate_taxes",
        "reserve_inventory",
        "validate_delivery",
        "authorize_payment",
        "create_order",
        "publish_events",
        "notify",
      ],
      circuit_state: ["closed", "open", "half_open"],
      commission_status: ["draft", "approved", "paid"],
      content_block_type: [
        "hero",
        "banner",
        "carousel",
        "product_collection",
        "category_collection",
        "rich_text",
        "campaign",
        "slider",
      ],
      content_item_kind: ["product", "variant", "category", "media"],
      content_page_kind: ["home", "landing", "legal"],
      content_status: ["draft", "published", "archived"],
      credit_status: ["ok", "watch", "blocked"],
      customer_kind: ["person", "company"],
      customer_tier: ["a", "b", "c"],
      delivery_plan_status: ["draft", "dispatched", "closed", "cancelled"],
      delivery_strategy: ["ship", "pickup", "local_delivery", "digital"],
      domain_event_status: [
        "pending",
        "in_flight",
        "processed",
        "failed",
        "dead",
      ],
      entitlement_source: ["hub", "provisioning"],
      fulfillment_state: [
        "pending",
        "allocated",
        "picking",
        "packed",
        "ready",
        "in_transit",
        "delivered",
        "failed",
        "cancelled",
      ],
      fulfillment_status: [
        "unfulfilled",
        "in_progress",
        "partially_fulfilled",
        "fulfilled",
        "returned",
        "cancelled",
      ],
      gift_card_movement: [
        "issue",
        "redeem",
        "refund",
        "adjust",
        "expire",
        "cancel",
      ],
      gift_card_status: ["active", "depleted", "expired", "cancelled"],
      goal_metric: ["amount", "units", "orders", "coverage"],
      integration_direction: ["outbound", "inbound", "bidirectional"],
      integration_kind: [
        "erp",
        "payment",
        "invoicing",
        "logistics",
        "messaging",
        "identity",
        "webhook",
      ],
      inventory_source: ["local", "erp"],
      invoice_status: [
        "pending",
        "issued",
        "accepted",
        "rejected",
        "cancelled",
      ],
      member_status: ["active", "invited", "revoked"],
      movement_kind: [
        "receipt",
        "issue",
        "return",
        "adjustment",
        "count",
        "transfer_in",
        "transfer_out",
      ],
      ops_event_kind: [
        "checkout_failed",
        "payment_failed",
        "integration_failed",
        "event_undelivered",
        "webhook_rejected",
        "slow_operation",
      ],
      ops_severity: ["info", "warning", "error", "critical"],
      order_approval_status: [
        "not_required",
        "pending",
        "approved",
        "rejected",
      ],
      order_event_axis: [
        "order_status",
        "payment_status",
        "fulfillment_status",
        "approval_status",
      ],
      order_event_source: [
        "storefront",
        "backoffice",
        "system",
        "api",
        "import",
      ],
      order_schedule_status: ["active", "paused", "finished"],
      order_source_channel: [
        "storefront",
        "backoffice",
        "api",
        "import",
        "scheduled",
        "repeat",
      ],
      order_status: ["pending", "paid", "fulfilled", "cancelled", "refunded"],
      outbox_status: ["pending", "in_flight", "succeeded", "failed", "dead"],
      payment_attempt_status: [
        "pending",
        "succeeded",
        "declined",
        "failed",
        "timeout",
      ],
      payment_capture_mode: ["automatic", "manual"],
      payment_event_source: [
        "provider_response",
        "provider_webhook",
        "browser_return",
        "operator",
        "system",
      ],
      payment_intent_status: [
        "open",
        "processing",
        "requires_action",
        "authorized",
        "captured",
        "failed",
        "cancelled",
        "expired",
      ],
      payment_method_kind: [
        "card",
        "wallet",
        "bank_transfer",
        "cash",
        "credit",
        "other",
      ],
      payment_record_status: ["captured", "partially_refunded", "refunded"],
      payment_status: [
        "pending",
        "authorized",
        "paid",
        "partially_refunded",
        "refunded",
        "failed",
        "voided",
      ],
      pod_outcome: ["delivered", "partial", "refused", "not_found"],
      price_scope: ["store", "channel", "segment", "customer"],
      product_kind: ["simple", "variant", "bundle"],
      product_relation_kind: [
        "related",
        "cross_sell",
        "up_sell",
        "accessory",
        "substitute",
        "spare_part",
      ],
      product_status: ["draft", "published", "archived"],
      promotion_audience_kind: [
        "all",
        "channel",
        "segment",
        "customer",
        "business_account",
      ],
      promotion_kind: [
        "percentage",
        "fixed_amount",
        "volume_tier",
        "x_for_y",
        "bundle",
      ],
      promotion_scope_kind: ["all", "product", "variant", "category", "brand"],
      promotion_status: ["draft", "active", "paused", "archived"],
      quote_status: ["draft", "sent", "accepted", "rejected", "expired"],
      reconciliation_status: ["unmatched", "matched", "discrepancy", "ignored"],
      refund_status: [
        "requested",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
      ],
      reservation_status: ["held", "committed", "released", "expired"],
      return_item_condition: [
        "pending",
        "sellable",
        "damaged",
        "used",
        "missing",
      ],
      return_resolution: ["refund", "exchange", "store_credit", "repair"],
      return_source: ["storefront", "backoffice", "api"],
      return_state: [
        "requested",
        "approved",
        "rejected",
        "in_transit",
        "received",
        "inspected",
        "completed",
        "cancelled",
      ],
      shipment_state: [
        "draft",
        "created",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "failed",
        "returned",
        "cancelled",
      ],
      sourcing_strategy: ["store_priority", "single_warehouse_atp"],
      stock_staleness_policy: ["unknown", "trust_last_known"],
      store_status: ["draft", "active", "suspended"],
      suggestion_status: ["draft", "sent", "accepted", "discarded"],
      tenant_status: ["active", "suspended", "closed"],
      tracking_source: [
        "provider_webhook",
        "provider_poll",
        "operator",
        "system",
      ],
      tracking_status: [
        "label_created",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivery_attempted",
        "delivered",
        "exception",
        "returned",
        "cancelled",
        "info",
      ],
      visit_frequency: ["weekly", "biweekly", "monthly", "on_demand"],
      visit_outcome: [
        "planned",
        "completed",
        "no_order",
        "closed",
        "rescheduled",
      ],
      warehouse_kind: ["warehouse", "store", "virtual"],
    },
  },
} as const
