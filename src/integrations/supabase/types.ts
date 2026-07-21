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
      editor_events: {
        Row: {
          design_id: string | null
          handle: string | null
          id: number
          payload: Json
          product_type: string | null
          session_key: string
          ts: string
          type: string
        }
        Insert: {
          design_id?: string | null
          handle?: string | null
          id?: never
          payload?: Json
          product_type?: string | null
          session_key: string
          ts?: string
          type: string
        }
        Update: {
          design_id?: string | null
          handle?: string | null
          id?: never
          payload?: Json
          product_type?: string | null
          session_key?: string
          ts?: string
          type?: string
        }
        Relationships: []
      }
      editor_sessions: {
        Row: {
          country: string | null
          created_at: string
          device: string | null
          email: string | null
          email_linked_at: string | null
          embedded: boolean | null
          first_handle: string | null
          id: string
          last_seen_at: string
          locale: string | null
          session_key: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          device?: string | null
          email?: string | null
          email_linked_at?: string | null
          embedded?: boolean | null
          first_handle?: string | null
          id?: string
          last_seen_at?: string
          locale?: string | null
          session_key: string
        }
        Update: {
          country?: string | null
          created_at?: string
          device?: string | null
          email?: string | null
          email_linked_at?: string | null
          embedded?: boolean | null
          first_handle?: string | null
          id?: string
          last_seen_at?: string
          locale?: string | null
          session_key?: string
        }
        Relationships: []
      }
      gelato_orders: {
        Row: {
          carrier: string | null
          created_at: string
          delivered_at: string | null
          error: string | null
          fulfilled_at: string | null
          gelato_order_id: string | null
          id: string
          last_status: string | null
          payload: Json | null
          raw: Json | null
          shopify_fulfillment_gid: string | null
          shopify_order_gid: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          status: string
          tracking_code: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          fulfilled_at?: string | null
          gelato_order_id?: string | null
          id?: string
          last_status?: string | null
          payload?: Json | null
          raw?: Json | null
          shopify_fulfillment_gid?: string | null
          shopify_order_gid?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          fulfilled_at?: string | null
          gelato_order_id?: string | null
          id?: string
          last_status?: string | null
          payload?: Json | null
          raw?: Json | null
          shopify_fulfillment_gid?: string | null
          shopify_order_gid?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          status?: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      generations: {
        Row: {
          completed_at: string | null
          created_at: string
          design_id: string | null
          duration_ms: number | null
          error: string | null
          handle: string | null
          id: string
          input_image_url: string | null
          layer_id: string | null
          output_image_url: string | null
          provider: string | null
          reference_image_url: string | null
          session_key: string | null
          status: string
          style_id: string | null
          style_label: string | null
          subject_kind: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          design_id?: string | null
          duration_ms?: number | null
          error?: string | null
          handle?: string | null
          id?: string
          input_image_url?: string | null
          layer_id?: string | null
          output_image_url?: string | null
          provider?: string | null
          reference_image_url?: string | null
          session_key?: string | null
          status?: string
          style_id?: string | null
          style_label?: string | null
          subject_kind?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          design_id?: string | null
          duration_ms?: number | null
          error?: string | null
          handle?: string | null
          id?: string
          input_image_url?: string | null
          layer_id?: string | null
          output_image_url?: string | null
          provider?: string | null
          reference_image_url?: string | null
          session_key?: string | null
          status?: string
          style_id?: string | null
          style_label?: string | null
          subject_kind?: string | null
        }
        Relationships: []
      }
      product_configs: {
        Row: {
          category_gid: string | null
          created_at: string
          description_html: string | null
          enabled_product_types: string[]
          gelato_sku_map: Json
          id: string
          is_consolidated: boolean
          is_freeform: boolean
          layouts: Json
          map_styles: Json
          product_type: string
          sales_channels: string[]
          seo_description: string | null
          seo_title: string | null
          shopify_handle: string
          sizes: Json
          status: string
          tags: string[]
          template: Json
          template_slug: string | null
          text_config: Json
          title: string
          updated_at: string
        }
        Insert: {
          category_gid?: string | null
          created_at?: string
          description_html?: string | null
          enabled_product_types?: string[]
          gelato_sku_map?: Json
          id?: string
          is_consolidated?: boolean
          is_freeform?: boolean
          layouts?: Json
          map_styles?: Json
          product_type: string
          sales_channels?: string[]
          seo_description?: string | null
          seo_title?: string | null
          shopify_handle: string
          sizes?: Json
          status?: string
          tags?: string[]
          template?: Json
          template_slug?: string | null
          text_config?: Json
          title: string
          updated_at?: string
        }
        Update: {
          category_gid?: string | null
          created_at?: string
          description_html?: string | null
          enabled_product_types?: string[]
          gelato_sku_map?: Json
          id?: string
          is_consolidated?: boolean
          is_freeform?: boolean
          layouts?: Json
          map_styles?: Json
          product_type?: string
          sales_channels?: string[]
          seo_description?: string | null
          seo_title?: string | null
          shopify_handle?: string
          sizes?: Json
          status?: string
          tags?: string[]
          template?: Json
          template_slug?: string | null
          text_config?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_app_installations: {
        Row: {
          access_token: string
          id: string
          installed_at: string
          scopes: string
          shop_domain: string
          updated_at: string
        }
        Insert: {
          access_token: string
          id?: string
          installed_at?: string
          scopes: string
          shop_domain: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          id?: string
          installed_at?: string
          scopes?: string
          shop_domain?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_sync_state: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string | null
          last_synced_payload: Json
          product_config_id: string
          shopify_product_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          last_synced_payload?: Json
          product_config_id: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          last_synced_payload?: Json
          product_config_id?: string
          shopify_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_sync_state_product_config_id_fkey"
            columns: ["product_config_id"]
            isOneToOne: true
            referencedRelation: "product_configs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
